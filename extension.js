import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import St from "gi://St";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const FRAME_BYTES = 16;
const BAR_COUNT = 36;
const RECONNECT_MS = 1000;
const IDLE_HIDE_MS = 180;
const MIN_BAR_HEIGHT = 3;
const MAX_BAR_HEIGHT = 30;

const VoxtypeOsd = GObject.registerClass(
  class VoxtypeOsd extends St.BoxLayout {
    _init() {
      super._init({
        style_class: "voxtype-osd-box",
        reactive: false,
        visible: false,
        vertical: true,
      });

      this._levels = new Array(BAR_COUNT).fill(0);
      this._lastFrameUs = 0;

      const header = new St.BoxLayout({
        style_class: "voxtype-osd-header",
        vertical: false,
      });
      this.add_child(header);

      this._title = new St.Label({
        style_class: "voxtype-osd-title",
        text: "VOXTYPE",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
      });
      header.add_child(this._title);

      this._status = new St.Label({
        style_class: "voxtype-osd-status",
        text: "recording",
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
      });
      header.add_child(this._status);

      this._waveform = new St.BoxLayout({
        style_class: "voxtype-osd-waveform",
        vertical: false,
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.CENTER,
      });
      this.add_child(this._waveform);

      this._bars = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        const bar = new St.Widget({
          style_class: "voxtype-osd-bar",
          y_align: Clutter.ActorAlign.CENTER,
        });
        bar.set_height(MIN_BAR_HEIGHT);
        this._waveform.add_child(bar);
        this._bars.push(bar);
      }
    }

    pushFrame(frame) {
      this._lastFrameUs = GLib.get_monotonic_time();
      this._levels.shift();
      this._levels.push(frame.peak);
      this._render();
      this.show();
    }

    updateIdle(nowUs) {
      if (!this.visible) return;

      if ((nowUs - this._lastFrameUs) / 1000 > IDLE_HIDE_MS) this.hide();
    }

    setDisconnected() {
      this._status.set_text("waiting");
      this.hide();
    }

    setConnected() {
      this._status.set_text("recording");
    }

    _render() {
      for (let i = 0; i < this._bars.length; i++) {
        const level = Math.max(0, Math.min(1, this._levels[i]));
        const eased = Math.sqrt(level);
        const height =
          MIN_BAR_HEIGHT +
          Math.round(eased * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT));
        this._bars[i].set_height(height);
      }
    }
  },
);

export default class VoxtypeOsdExtension extends Extension {
  enable() {
    this._socketPath = GLib.build_filenamev([
      GLib.getenv("XDG_RUNTIME_DIR") ?? "/tmp",
      "voxtype",
      "audio.sock",
    ]);

    this._destroyed = false;
    this._stream = null;
    this._readBuffer = new Uint8Array(FRAME_BYTES);
    this._readOffset = 0;

    this._osd = new VoxtypeOsd();
    Main.layoutManager.addTopChrome(this._osd, { affectsStruts: false });
    this._positionOsd();

    this._idleSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
      this._osd.updateIdle(GLib.get_monotonic_time());
      return GLib.SOURCE_CONTINUE;
    });

    this._connect();
  }

  disable() {
    this._destroyed = true;

    if (this._connectSource) {
      GLib.source_remove(this._connectSource);
      this._connectSource = 0;
    }
    if (this._idleSource) {
      GLib.source_remove(this._idleSource);
      this._idleSource = 0;
    }
    if (this._stream) {
      try {
        this._stream.close(null);
      } catch (_) {}
      this._stream = null;
    }
    if (this._osd) {
      this._osd.destroy();
      this._osd = null;
    }
  }

  _positionOsd() {
    const monitor = Main.layoutManager.primaryMonitor;
    const width = 336;
    const height = 76;
    const x = monitor.x + Math.floor((monitor.width - width) / 2);
    const y = monitor.y + Math.floor(monitor.height * 0.82);

    this._osd.set_position(x, y);
    this._osd.set_size(width, height);
  }

  _connect() {
    if (this._destroyed) return;

    const address = Gio.UnixSocketAddress.new(this._socketPath);
    const client = new Gio.SocketClient();

    client.connect_async(address, null, (source, result) => {
      if (this._destroyed) return;

      try {
        const connection = source.connect_finish(result);
        this._stream = connection.get_input_stream();
        this._readOffset = 0;
        this._osd.setConnected();
        this._readNextChunk();
      } catch (_) {
        this._osd.setDisconnected();
        this._scheduleReconnect();
      }
    });
  }

  _scheduleReconnect() {
    if (this._destroyed || this._connectSource) return;

    this._connectSource = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      RECONNECT_MS,
      () => {
        this._connectSource = 0;
        this._connect();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _readNextChunk() {
    if (this._destroyed || !this._stream) return;

    const remaining = FRAME_BYTES - this._readOffset;
    this._stream.read_bytes_async(
      remaining,
      GLib.PRIORITY_DEFAULT,
      null,
      (source, result) => {
        if (this._destroyed) return;

        let bytes;
        try {
          bytes = source.read_bytes_finish(result);
        } catch (_) {
          this._disconnectAndReconnect();
          return;
        }

        if (bytes.get_size() === 0) {
          this._disconnectAndReconnect();
          return;
        }

        const chunk = bytes.toArray();
        this._readBuffer.set(chunk, this._readOffset);
        this._readOffset += chunk.length;

        if (this._readOffset === FRAME_BYTES) {
          this._osd.pushFrame(this._decodeFrame(this._readBuffer));
          this._readOffset = 0;
        }

        this._readNextChunk();
      },
    );
  }

  _disconnectAndReconnect() {
    if (this._stream) {
      try {
        this._stream.close(null);
      } catch (_) {}
      this._stream = null;
    }
    this._osd.setDisconnected();
    this._scheduleReconnect();
  }

  _decodeFrame(buffer) {
    const view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    const min = view.getFloat32(4, true);
    const max = view.getFloat32(8, true);
    const peakDbfs = view.getFloat32(12, true);
    const peakFromSamples = Math.max(Math.abs(min), Math.abs(max));
    const peakFromDb = peakDbfs <= -120 ? 0 : Math.pow(10, peakDbfs / 20);

    return { peak: Math.max(peakFromSamples, peakFromDb) };
  }
}
