# Voxtype OSD for GNOME Shell

A small GNOME Shell extension that shows a waveform while Voxtype dictation is
recording. The OSD turns amber and shows a timeout countdown during the final
minute, or the final 10% of `[audio].max_duration_secs` if that is shorter.

This is an unofficial integration for Voxtype. Voxtype must be installed and
running separately.

The extension also owns Voxtype's GNOME shortcuts:

- `Super+H`: toggle dictation
- `Super+C`: cancel dictation
- `Super+Shift+H`: start/stop meeting mode
- `Super+Shift+P`: pause/resume meeting mode

When meeting mode is active, a separate meeting pill appears with elapsed time
and pause state. Meeting mode is timer-only because Voxtype's meeting capture
path does not currently publish audio levels to the OSD socket.

The extension also watches Voxtype's state file so the recording pill is
restored after GNOME lock/unlock if Voxtype is still recording.

Shortcuts can be changed from the extension preferences window.

## Install

```sh
gnome-extensions pack . --force
gnome-extensions install --force voxtype-osd@adamkadaban.github.io.shell-extension.zip
gnome-extensions enable voxtype-osd@adamkadaban.github.io
```

Log out and back in if GNOME Shell does not see the extension immediately.

## Notes

The extension reads Voxtype's existing audio-level socket at
`$XDG_RUNTIME_DIR/voxtype/audio.sock`. Voxtype must be running. The built-in
Voxtype OSD can remain disabled.

The timeout warning reads `~/.config/voxtype/config.toml` and falls back to
Voxtype's default 60 second recording limit if the config cannot be read.

## Publishing

Build the upload ZIP with the runtime files and license:

```sh
gnome-extensions pack . --force --extra-source=LICENSE
```

Upload `voxtype-osd@adamkadaban.github.io.shell-extension.zip` to
https://extensions.gnome.org/upload/.

## License

GPL-2.0-only.
