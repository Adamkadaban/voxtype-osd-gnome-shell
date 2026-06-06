import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GObject from "gi://GObject";
import Gtk from "gi://Gtk";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const SETTINGS_SCHEMA = "org.gnome.shell.extensions.voxtype-osd";

const SHORTCUTS = [
  {
    key: "toggle-dictation",
    title: "Toggle dictation",
    subtitle: "Start or stop regular Voxtype dictation",
  },
  {
    key: "cancel-dictation",
    title: "Cancel dictation",
    subtitle: "Abort the current recording or transcription",
  },
  {
    key: "toggle-meeting",
    title: "Start or stop meeting",
    subtitle: "Start meeting mode when idle, stop it when active",
  },
  {
    key: "pause-resume-meeting",
    title: "Pause or resume meeting",
    subtitle: "Pause an active meeting or resume a paused one",
  },
];

const ShortcutRow = GObject.registerClass(
  class ShortcutRow extends Adw.ActionRow {
    _init(settings, shortcut) {
      super._init({ title: shortcut.title, subtitle: shortcut.subtitle });

      this._settings = settings;
      this._key = shortcut.key;

      this._button = new Gtk.Button({ valign: Gtk.Align.CENTER });
      this._button.connect("clicked", () => this._captureShortcut());
      this.add_suffix(this._button);

      this._resetButton = new Gtk.Button({
        icon_name: "edit-clear-symbolic",
        tooltip_text: "Clear shortcut",
        valign: Gtk.Align.CENTER,
      });
      this._resetButton.connect("clicked", () => {
        this._settings.set_strv(this._key, []);
        this._syncLabel();
      });
      this.add_suffix(this._resetButton);

      this.activatable_widget = this._button;
      this._syncLabel();
    }

    _syncLabel() {
      const accelerator = this._settings.get_strv(this._key)[0] || "";
      this._button.label = accelerator || "Disabled";
    }

    _captureShortcut() {
      const dialog = new Gtk.Dialog({
        title: `Set ${this.title}`,
        modal: true,
        transient_for: this.get_root(),
        use_header_bar: 1,
      });
      dialog.add_button("Cancel", Gtk.ResponseType.CANCEL);
      dialog.add_button("Clear", Gtk.ResponseType.REJECT);

      const content = dialog.get_content_area();
      content.margin_top = 24;
      content.margin_bottom = 24;
      content.margin_start = 24;
      content.margin_end = 24;
      content.spacing = 12;

      const label = new Gtk.Label({
        label: "Press a new shortcut now",
        css_classes: ["title-2"],
      });
      content.append(label);

      const hint = new Gtk.Label({
        label: "Use Escape to cancel, Backspace to clear.",
        css_classes: ["dim-label"],
      });
      content.append(hint);

      const controller = new Gtk.EventControllerKey();
      controller.connect("key-pressed", (_controller, keyval, keycode, state) => {
        if (keyval === Gdk.KEY_Escape) {
          dialog.response(Gtk.ResponseType.CANCEL);
          return Gdk.EVENT_STOP;
        }

        if (keyval === Gdk.KEY_BackSpace) {
          dialog.response(Gtk.ResponseType.REJECT);
          return Gdk.EVENT_STOP;
        }

        const modifiers = state & Gtk.accelerator_get_default_mod_mask();
        const accelerator = Gtk.accelerator_name(keyval, modifiers);
        if (Gtk.accelerator_valid(keyval, modifiers) && accelerator) {
          this._settings.set_strv(this._key, [accelerator]);
          this._syncLabel();
          dialog.response(Gtk.ResponseType.OK);
          return Gdk.EVENT_STOP;
        }

        return Gdk.EVENT_PROPAGATE;
      });
      dialog.add_controller(controller);

      dialog.connect("response", (_dialog, response) => {
        if (response === Gtk.ResponseType.REJECT) {
          this._settings.set_strv(this._key, []);
          this._syncLabel();
        }
        dialog.destroy();
      });
      dialog.present();
    }
  },
);

export default class VoxtypeOsdPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this._createSettings();

    const page = new Adw.PreferencesPage({
      title: "Voxtype OSD",
      icon_name: "audio-input-microphone-symbolic",
    });
    window.add(page);

    const group = new Adw.PreferencesGroup({
      title: "Shortcuts",
      description:
        "These shortcuts are handled by the GNOME Shell extension. Changes apply immediately.",
    });
    page.add(group);

    for (const shortcut of SHORTCUTS) {
      group.add(new ShortcutRow(settings, shortcut));
    }
  }

  _createSettings() {
    const schemaDir = this.dir.get_child("schemas").get_path();
    const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
      schemaDir,
      Gio.SettingsSchemaSource.get_default(),
      false,
    );
    const schema = schemaSource.lookup(SETTINGS_SCHEMA, false);
    if (!schema) throw new Error(`Schema ${SETTINGS_SCHEMA} not found`);

    return new Gio.Settings({ settings_schema: schema });
  }
}
