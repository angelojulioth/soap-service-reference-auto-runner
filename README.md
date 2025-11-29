# SOAP Service Reference Auto-Runner

A VS Code extension that automatically runs `dotnet-svcutil` when `dotnet-svcutil.params.json` files change in ServiceReference folders. This streamlines SOAP service development by keeping your service references up to date automatically.

## Features

- **Automatic File Watching**: Monitors all `dotnet-svcutil.params.json` files in `ServiceReference` folders across your workspace
- **Auto-execution**: Runs `dotnet-svcutil` automatically when params files change or are created
- **Generate Initial Config**: Create `dotnet-svcutil.params.json` files with guided setup
- **Selective Watching**: Choose which project directories to monitor with file watchers
- **Project Discovery**: Automatically finds .csproj files and suggests relevant directories
- **Manual Trigger**: Right-click context menu option to manually run `dotnet-svcutil` on params files
- **Progress Indication**: Shows progress notifications during service reference generation
- **Output Channel**: Dedicated output channel for viewing `dotnet-svcutil` execution logs
- **Configurable**: Settings to control auto-run behavior and notifications

## Requirements

- **.NET SDK**: Must have .NET SDK installed with `dotnet-svcutil` tool available
- **Workspace**: Requires an open VS Code workspace with SOAP projects containing `ServiceReference` folders

## Extension Settings

This extension contributes the following settings:

- `soapServiceReference.autoRun`: Enable/disable automatic running of dotnet-svcutil when params files change (default: `true`)
- `soapServiceReference.showNotifications`: Show success/error notifications when dotnet-svcutil runs (default: `true`)

## Usage

### Automatic Mode (Default)
1. Open a workspace containing SOAP projects with `ServiceReference/dotnet-svcutil.params.json` files
2. The extension will automatically watch for changes to these files
3. When a file changes, `dotnet-svcutil` will run automatically
4. Check the "SOAP Service Reference Auto-Runner" output channel for execution details

### Manual Mode
1. Open a `dotnet-svcutil.params.json` file in the editor
2. Right-click and select "Run dotnet-svcutil" from the context menu
3. Or use the Command Palette: `Ctrl+Shift+P` → "SOAP: Run dotnet-svcutil"

### Creating New Service References
1. Use Command Palette: `Ctrl+Shift+P` → "SOAP: Generate dotnet-svcutil.params.json"
2. Or right-click on a folder in Explorer → "Generate dotnet-svcutil.params.json"
3. Follow the guided setup to enter WSDL URL, namespace, and target framework
4. The extension will create the params file and ServiceReference folder structure

### Setting Up Custom File Watchers
1. Use Command Palette: `Ctrl+Shift+P` → "SOAP: Setup File Watchers"
2. Select which project directories you want to monitor
3. The extension will watch only the selected directories for changes

## Project Structure

The extension expects the following project structure:
```
YourProject/
├── ServiceReference/
│   ├── dotnet-svcutil.params.json
│   └── Reference.cs (generated)
└── YourProject.csproj
```

## Commands

- `SOAP: Run dotnet-svcutil` - Manually run dotnet-svcutil on the current params file
- `SOAP: Generate dotnet-svcutil.params.json` - Create a new params file with guided setup
- `SOAP: Setup File Watchers` - Select project directories to monitor for changes

## Known Issues

- The extension requires `dotnet-svcutil` to be available in the system PATH
- File watching only works for files in the workspace; external files are not monitored

## Release Notes

### 0.0.1

- Initial release
- Automatic file watching for `dotnet-svcutil.params.json` files
- Manual command execution via context menu
- Configurable settings for auto-run and notifications
- Progress indication and output channel logging

## Development

To run the extension in development mode:

1. Clone the repository
2. Run `npm install` to install dependencies
3. Press `F5` to launch the Extension Development Host
4. Test the extension with your SOAP projects

To build the extension:
```bash
npm run compile
```

To run tests:
```bash
npm test
```

## License

This extension is provided as-is for development purposes. See the LICENSE file for details.

**Enjoy streamlined SOAP service development!**
