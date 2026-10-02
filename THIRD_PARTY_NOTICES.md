# Third-Party Notices

Agent Island is licensed under the MIT License. Version 0.12.0 is built with .NET 8, WPF, and Windows Forms. The self-contained distribution includes Microsoft's desktop runtime under its applicable licenses; framework-dependent builds use the separately installed runtime. System fonts are referenced, not bundled.

- .NET: MIT License and third-party notices — https://github.com/dotnet/runtime
- WPF: MIT License — https://github.com/dotnet/wpf
- Windows Forms: MIT License — https://github.com/dotnet/winforms

The earlier implementation and optional icon-rendering development tool use Electron and electron-builder, which remain subject to their own licenses. They are not bundled in the native application.

Packaged Electron distributions include the Electron license and Chromium open-source notices in the generated application resources. The exact JavaScript dependency graph and pinned versions for this release are recorded in `package-lock.json`.

- Electron: MIT License — https://github.com/electron/electron
- electron-builder: MIT License — https://github.com/electron-userland/electron-builder
- Chromium third-party licenses — included in Electron distributions as `LICENSES.chromium.html`

Names and trademarks referenced by integrations belong to their respective owners. Their mention does not imply endorsement.
