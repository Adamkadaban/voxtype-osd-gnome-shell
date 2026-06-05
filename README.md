# Voxtype OSD for GNOME Shell

A small GNOME Shell extension that shows a waveform while Voxtype is recording.

## Install

```sh
gnome-extensions pack . --force
gnome-extensions install --force voxtype-osd@voxtype.io.shell-extension.zip
gnome-extensions enable voxtype-osd@voxtype.io
```

Log out and back in if GNOME Shell does not see the extension immediately.

## Notes

The extension reads Voxtype's existing audio-level socket at `$XDG_RUNTIME_DIR/voxtype/audio.sock`. Voxtype must be running with its audio OSD socket enabled.
