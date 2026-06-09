import GLib from "gi://GLib";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Clutter from "gi://Clutter";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

const FRAME_BYTES = 16;
const BAR_COUNT = 36;
const RECONNECT_MS = 1000;
const IDLE_HIDE_MS = 180;
const MIN_BAR_HEIGHT = 3;
const MAX_BAR_HEIGHT = 30;
const DEFAULT_MAX_DURATION_SECS = 60;
const WARNING_MAX_SECS = 60;
const WARNING_RATIO = 0.1;
const KEYBINDINGS = [
  ["toggle-dictation", ["voxtype", "record", "toggle"]],
  ["cancel-dictation", ["voxtype", "record", "cancel"]],
  ["toggle-meeting", null],
  ["pause-resume-meeting", null],
];

const VoxtypeOsd = GObject.registerClass(
  class VoxtypeOsd extends St.BoxLayout {
    _init(maxDurationSecs) {
      super._init({
        style_class: "voxtype-osd-box",
        reactive: false,
        visible: false,
        vertical: true,
      });

      this._levels = new Array(BAR_COUNT).fill(0);
      this._lastFrameUs = 0;
      this._recordingStartedUs = 0;
      this._recordingState = false;
      this._stateRestored = false;
      this._warning = false;
      this._maxDurationSecs = maxDurationSecs;

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
      const nowUs = GLib.get_monotonic_time();

      if (!this._recordingStartedUs) this._recordingStartedUs = nowUs;

      this._lastFrameUs = nowUs;
      this._stateRestored = false;
      this._levels.shift();
      this._levels.push(frame.peak);
      this._updateTimeout(nowUs);
      this._render();
      this.show();
    }

    updateIdle(nowUs) {
      if (!this.visible) return;

      if (this._stateRestored) {
        return;
      }

      if ((nowUs - this._lastFrameUs) / 1000 > IDLE_HIDE_MS) {
        if (this._recordingState) {
          this._stateRestored = true;
          this._setWarning(false);
          this._status.set_text("recording");
          return;
        }

        this._recordingStartedUs = 0;
        this._setWarning(false);
        this._status.set_text("recording");
        this.hide();
        return;
      }

      this._updateTimeout(nowUs);
    }

    setDisconnected() {
      this._recordingStartedUs = 0;
      this._stateRestored = false;
      this._setWarning(false);
      this._status.set_text("waiting");
      this.hide();
    }

    setConnected() {
      this._recordingStartedUs = 0;
      this._stateRestored = false;
      this._setWarning(false);
      this._status.set_text("recording");
    }

    setRecordingState(recording) {
      this._recordingState = recording;

      if (recording) {
        if (!this.visible) {
          const nowUs = GLib.get_monotonic_time();
          this._lastFrameUs = nowUs;
          if (!this._recordingStartedUs) this._recordingStartedUs = nowUs;
          this._stateRestored = true;
          this._levels.fill(MIN_BAR_HEIGHT / MAX_BAR_HEIGHT);
          this._setWarning(false);
          this._status.set_text("recording");
          this._render();
          this.show();
        }
        return;
      }

      if (this._stateRestored) {
        this._stateRestored = false;
        this._recordingStartedUs = 0;
        this.hide();
      }
    }

    setMaxDurationSecs(maxDurationSecs) {
      this._maxDurationSecs = maxDurationSecs;
    }

    _updateTimeout(nowUs) {
      if (!this._recordingStartedUs || !this._maxDurationSecs) return;

      const elapsedSecs = (nowUs - this._recordingStartedUs) / 1000000;
      const remainingSecs = Math.max(
        0,
        Math.ceil(this._maxDurationSecs - elapsedSecs),
      );
      const warningSecs = Math.max(
        1,
        Math.min(WARNING_MAX_SECS, Math.ceil(this._maxDurationSecs * WARNING_RATIO)),
      );

      if (remainingSecs <= warningSecs) {
        this._setWarning(true);
        this._status.set_text(`timeout ${this._formatRemaining(remainingSecs)}`);
      } else {
        this._setWarning(false);
        this._status.set_text("recording");
      }
    }

    _formatRemaining(seconds) {
      if (seconds >= 60) {
        const minutes = Math.floor(seconds / 60);
        const remainder = String(seconds % 60).padStart(2, "0");
        return `${minutes}:${remainder}`;
      }

      return `${seconds}s`;
    }

    _setWarning(enabled) {
      if (this._warning === enabled) return;

      this._warning = enabled;
      const method = enabled ? "add_style_class_name" : "remove_style_class_name";
      this[method]("voxtype-osd-box-warning");
      this._status[method]("voxtype-osd-status-warning");
      for (const bar of this._bars) bar[method]("voxtype-osd-bar-warning");
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

const MeetingOsd = GObject.registerClass(
  class MeetingOsd extends St.BoxLayout {
    _init() {
      super._init({
        style_class: "voxtype-meeting-box",
        reactive: false,
        visible: false,
        vertical: true,
      });

      this._meetingStartedUs = 0;
      this._pausedAtUs = 0;
      this._pausedTotalUs = 0;
      this._state = "idle";
      this._meetingId = "";

      const header = new St.BoxLayout({
        style_class: "voxtype-meeting-header",
        vertical: false,
      });
      this.add_child(header);

      this._title = new St.Label({
        style_class: "voxtype-meeting-title",
        text: "MEETING",
        x_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.CENTER,
      });
      header.add_child(this._title);

      this._status = new St.Label({
        style_class: "voxtype-meeting-status",
        text: "idle",
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
      });
      header.add_child(this._status);
    }

    update(nowUs) {
      if (!this._isActive()) return;

      this._status.set_text(this._statusText(nowUs));
    }

    setMeetingState(state, meetingId) {
      const nowUs = GLib.get_monotonic_time();
      const previousState = this._state;
      this._state = state || "idle";
      this._meetingId = meetingId || "";

      if (this._state === "recording") {
        if (!this._meetingStartedUs) this._meetingStartedUs = nowUs;
        if (previousState === "paused" && this._pausedAtUs) {
          this._pausedTotalUs += nowUs - this._pausedAtUs;
          this._pausedAtUs = 0;
        }
        this._setPaused(false);
        this._status.set_text(this._statusText(nowUs));
        this.show();
        return;
      }

      if (this._state === "paused") {
        if (!this._meetingStartedUs) this._meetingStartedUs = nowUs;
        if (!this._pausedAtUs) this._pausedAtUs = nowUs;
        this._setPaused(true);
        this._status.set_text("paused");
        this.show();
        return;
      }

      this._meetingStartedUs = 0;
      this._pausedAtUs = 0;
      this._pausedTotalUs = 0;
      this._setPaused(false);
      this.hide();
    }

    currentState() {
      return this._state;
    }

    _isActive() {
      return this._state === "recording" || this._state === "paused";
    }

    _statusText(nowUs) {
      if (this._state === "paused") return "paused";
      if (!this._meetingStartedUs) return "recording";

      const elapsedSecs = Math.max(
        0,
        Math.floor((nowUs - this._meetingStartedUs - this._pausedTotalUs) / 1000000),
      );
      const minutes = Math.floor(elapsedSecs / 60);
      const seconds = String(elapsedSecs % 60).padStart(2, "0");
      return `${minutes}:${seconds}`;
    }

    _setPaused(paused) {
      const method = paused ? "add_style_class_name" : "remove_style_class_name";
      this[method]("voxtype-meeting-box-paused");
      this._status[method]("voxtype-meeting-status-paused");
    }
  },
);

export default class VoxtypeOsdExtension extends Extension {
  enable() {
    this._generation = (this._generation ?? 0) + 1;
    this._settings = this.getSettings();
    this._socketPath = GLib.build_filenamev([
      GLib.getenv("XDG_RUNTIME_DIR") ?? "/tmp",
      "voxtype",
      "audio.sock",
    ]);
    this._statePath = GLib.build_filenamev([
      GLib.getenv("XDG_RUNTIME_DIR") ?? "/tmp",
      "voxtype",
      "state",
    ]);
    this._meetingStatePath = GLib.build_filenamev([
      GLib.getenv("XDG_RUNTIME_DIR") ?? "/tmp",
      "voxtype",
      "meeting_state",
    ]);

    this._stream = null;
    this._readBuffer = new Uint8Array(FRAME_BYTES);
    this._readOffset = 0;
    this._stateMonitor = null;
    this._stateMonitorChangedId = 0;
    this._stateSource = 0;
    this._meetingStateMonitor = null;
    this._meetingStateMonitorChangedId = 0;
    this._meetingStateSource = 0;
    this._meetingState = { state: "idle", meetingId: "" };

    this._osd = new VoxtypeOsd(DEFAULT_MAX_DURATION_SECS);
    Main.layoutManager.addTopChrome(this._osd, { affectsStruts: false });
    this._positionOsd();

    this._meetingOsd = new MeetingOsd();
    Main.layoutManager.addTopChrome(this._meetingOsd, { affectsStruts: false });
    this._positionMeetingOsd();

    this._osdVisibleId = this._osd.connect("notify::visible", () => {
      if (this._osd.visible) this._positionOsd();
    });
    this._meetingOsdVisibleId = this._meetingOsd.connect("notify::visible", () => {
      if (this._meetingOsd.visible) this._positionMeetingOsd();
    });
    this._monitorSettingId = this._settings.connect("changed::monitor", () => {
      this._positionOsd();
      this._positionMeetingOsd();
    });
    this._monitorsChangedId = Main.layoutManager.connect("monitors-changed", () => {
      this._positionOsd();
      this._positionMeetingOsd();
    });

    const generation = this._generation;
    this._idleSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
      if (generation !== this._generation) {
        return GLib.SOURCE_REMOVE;
      }

      const nowUs = GLib.get_monotonic_time();
      this._osd.updateIdle(nowUs);
      this._meetingOsd.update(nowUs);
      return GLib.SOURCE_CONTINUE;
    });

    this._addKeybindings();
    this._watchState();
    this._watchMeetingState();
    this._refreshMaxDurationSecs();
    this._refreshState();
    this._refreshMeetingState();
    this._connect();
  }

  disable() {
    this._generation = (this._generation ?? 0) + 1;

    if (this._connectSource) {
      GLib.source_remove(this._connectSource);
      this._connectSource = 0;
    }
    if (this._idleSource) {
      GLib.source_remove(this._idleSource);
      this._idleSource = 0;
    }
    if (this._stateSource) {
      GLib.source_remove(this._stateSource);
      this._stateSource = 0;
    }
    if (this._meetingStateSource) {
      GLib.source_remove(this._meetingStateSource);
      this._meetingStateSource = 0;
    }
    if (this._stateMonitor) {
      if (this._stateMonitorChangedId) {
        this._stateMonitor.disconnect(this._stateMonitorChangedId);
        this._stateMonitorChangedId = 0;
      }
      this._stateMonitor.cancel();
      this._stateMonitor = null;
    }
    if (this._meetingStateMonitor) {
      if (this._meetingStateMonitorChangedId) {
        this._meetingStateMonitor.disconnect(this._meetingStateMonitorChangedId);
        this._meetingStateMonitorChangedId = 0;
      }
      this._meetingStateMonitor.cancel();
      this._meetingStateMonitor = null;
    }
    if (this._monitorsChangedId) {
      Main.layoutManager.disconnect(this._monitorsChangedId);
      this._monitorsChangedId = 0;
    }
    if (this._monitorSettingId) {
      this._settings.disconnect(this._monitorSettingId);
      this._monitorSettingId = 0;
    }
    this._removeKeybindings();
    if (this._stream) {
      try {
        this._stream.close(null);
      } catch (_) {}
      this._stream = null;
    }
    if (this._osd) {
      if (this._osdVisibleId) {
        this._osd.disconnect(this._osdVisibleId);
        this._osdVisibleId = 0;
      }
      this._osd.destroy();
      this._osd = null;
    }
    if (this._meetingOsd) {
      if (this._meetingOsdVisibleId) {
        this._meetingOsd.disconnect(this._meetingOsdVisibleId);
        this._meetingOsdVisibleId = 0;
      }
      this._meetingOsd.destroy();
      this._meetingOsd = null;
    }
    this._settings = null;
  }

  _getTargetMonitor() {
    const mode = this._settings?.get_string("monitor") ?? "primary";
    if (mode === "active") {
      const index = global.display.get_current_monitor();
      const monitors = Main.layoutManager.monitors;
      if (index >= 0 && index < monitors.length) return monitors[index];
    }
    return Main.layoutManager.primaryMonitor;
  }

  _positionOsd() {
    const monitor = this._getTargetMonitor();
    const width = 336;
    const height = 76;
    const x = monitor.x + Math.floor((monitor.width - width) / 2);
    const y = monitor.y + Math.floor(monitor.height * 0.82);

    this._osd.set_position(x, y);
    this._osd.set_size(width, height);
  }

  _positionMeetingOsd() {
    const monitor = this._getTargetMonitor();
    const width = 336;
    const height = 44;
    const x = monitor.x + Math.floor((monitor.width - width) / 2);
    const y = monitor.y + Math.floor(monitor.height * 0.76);

    this._meetingOsd.set_position(x, y);
    this._meetingOsd.set_size(width, height);
  }

  _connect() {
    const generation = this._generation;
    const address = Gio.UnixSocketAddress.new(this._socketPath);
    const client = new Gio.SocketClient();

    client.connect_async(address, null, (source, result) => {
      if (generation !== this._generation) return;

      try {
        const connection = source.connect_finish(result);
        this._stream = connection.get_input_stream();
        this._readOffset = 0;
        this._refreshMaxDurationSecs();
        this._osd.setConnected();
        this._refreshState();
        this._readNextChunk();
      } catch (_) {
        this._osd.setDisconnected();
        this._refreshState();
        this._scheduleReconnect();
      }
    });
  }

  _scheduleReconnect() {
    if (this._connectSource) return;

    const generation = this._generation;
    this._connectSource = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      RECONNECT_MS,
      () => {
        this._connectSource = 0;
        if (generation !== this._generation) {
          return GLib.SOURCE_REMOVE;
        }
        this._connect();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _readNextChunk() {
    if (!this._stream) return;

    const generation = this._generation;
    const remaining = FRAME_BYTES - this._readOffset;
    this._stream.read_bytes_async(
      remaining,
      GLib.PRIORITY_DEFAULT,
      null,
      (source, result) => {
        if (generation !== this._generation) return;

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
          const frame = this._decodeFrame(this._readBuffer);
          if (this._osd) this._osd.pushFrame(frame);
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
    if (!this._osd) return;
    this._osd.setDisconnected();
    this._refreshState();
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

  _refreshMaxDurationSecs() {
    const configHome =
      GLib.getenv("XDG_CONFIG_HOME") ??
      GLib.build_filenamev([GLib.get_home_dir(), ".config"]);
    const configPath = GLib.build_filenamev([
      configHome,
      "voxtype",
      "config.toml",
    ]);

    this._loadTextFile(configPath, (contents) => {
      if (!this._osd) return;

      const maxDurationSecs = contents
        ? this._parseMaxDurationSecs(contents)
        : DEFAULT_MAX_DURATION_SECS;
      this._osd.setMaxDurationSecs(maxDurationSecs);
    });
  }

  _parseMaxDurationSecs(configText) {
    let inAudioSection = false;

    for (const rawLine of configText.split(/\r?\n/)) {
      const line = rawLine.replace(/#.*/, "").trim();
      if (!line) continue;

      const section = line.match(/^\[([^\]]+)\]$/);
      if (section) {
        inAudioSection = section[1].trim() === "audio";
        continue;
      }

      if (!inAudioSection) continue;

      const value = line.match(/^max_duration_secs\s*=\s*(\d+)\s*$/);
      if (!value) continue;

      const seconds = Number.parseInt(value[1], 10);
      if (Number.isFinite(seconds) && seconds > 0) return seconds;
    }

    return DEFAULT_MAX_DURATION_SECS;
  }

  _addKeybindings() {
    for (const [name, command] of KEYBINDINGS) {
      Main.wm.addKeybinding(
        name,
        this._settings,
        Meta.KeyBindingFlags.NONE,
        Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
        () => {
          if (name === "toggle-meeting") {
            this._toggleMeeting();
          } else if (name === "pause-resume-meeting") {
            this._pauseResumeMeeting();
          } else {
            this._spawn(command);
          }
        },
      );
    }
  }

  _removeKeybindings() {
    for (const [name] of KEYBINDINGS) Main.wm.removeKeybinding(name);
  }

  _toggleMeeting() {
    const state = this._meetingState.state;
    if (state === "recording" || state === "paused") {
      this._spawn(["voxtype", "meeting", "stop"]);
    } else {
      this._spawn(["voxtype", "meeting", "start"]);
    }
  }

  _pauseResumeMeeting() {
    this._loadTextFile(this._meetingStatePath, (contents) => {
      const { state } = this._parseMeetingState(contents);
      if (state === "recording") {
        this._spawn(["voxtype", "meeting", "pause"]);
      } else if (state === "paused") {
        this._spawn(["voxtype", "meeting", "resume"]);
      }
    });
  }

  _spawn(argv) {
    try {
      Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
    } catch (error) {
      console.error(`Voxtype OSD failed to run ${argv.join(" ")}: ${error}`);
    }
  }

  _watchState() {
    const file = Gio.File.new_for_path(this._statePath);
    try {
      this._stateMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
      this._stateMonitorChangedId = this._stateMonitor.connect("changed", () =>
        this._debounceStateRefresh(),
      );
    } catch (error) {
      console.error(`Voxtype OSD failed to watch state: ${error}`);
    }
  }

  _debounceStateRefresh() {
    if (this._stateSource) return;

    const generation = this._generation;
    this._stateSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      this._stateSource = 0;
      if (generation === this._generation) this._refreshState();
      return GLib.SOURCE_REMOVE;
    });
  }

  _refreshState() {
    if (!this._osd) return;
    this._loadTextFile(this._statePath, (contents) => {
      if (!this._osd) return;

      const state = contents?.trim() || "idle";
      this._osd.setRecordingState(state === "recording");
    });
  }

  _watchMeetingState() {
    const file = Gio.File.new_for_path(this._meetingStatePath);
    try {
      this._meetingStateMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
      this._meetingStateMonitorChangedId = this._meetingStateMonitor.connect("changed", () =>
        this._debounceMeetingStateRefresh(),
      );
    } catch (error) {
      console.error(`Voxtype OSD failed to watch meeting state: ${error}`);
    }
  }

  _debounceMeetingStateRefresh() {
    if (this._meetingStateSource) return;

    const generation = this._generation;
    this._meetingStateSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
      this._meetingStateSource = 0;
      if (generation === this._generation) this._refreshMeetingState();
      return GLib.SOURCE_REMOVE;
    });
  }

  _refreshMeetingState() {
    if (!this._meetingOsd) return;
    this._loadTextFile(this._meetingStatePath, (contents) => {
      if (!this._meetingOsd) return;

      this._meetingState = this._parseMeetingState(contents);
      this._meetingOsd.setMeetingState(
        this._meetingState.state,
        this._meetingState.meetingId,
      );
    });
  }

  _parseMeetingState(contents) {
    if (!contents) return { state: "idle", meetingId: "" };

    const lines = contents.trim().split(/\r?\n/);
    return {
      state: lines[0] || "idle",
      meetingId: lines[1] || "",
    };
  }

  _loadTextFile(path, callback) {
    const file = Gio.File.new_for_path(path);
    const generation = this._generation;
    try {
      file.load_contents_async(null, (source, result) => {
        if (generation !== this._generation) return;

        try {
          const [ok, contents] = source.load_contents_finish(result);
          callback(ok ? new TextDecoder().decode(contents) : null);
        } catch (_) {
          callback(null);
        }
      });
    } catch (_) {
      callback(null);
    }
  }
}
