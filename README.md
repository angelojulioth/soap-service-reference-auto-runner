# SOAP Service Reference Auto-Runner

A VS Code extension that monitors WSDL endpoints for changes and automatically updates your .NET service references. Perfect for SOAP service development with real-time WSDL change detection and integrated C# project management.

## Features

- **WSDL Change Detection**: Monitors actual WSDL endpoints (not just files) for content changes
- **Smart Monitoring**: Polls WSDL URLs every 30 seconds and detects changes via content hashing
- **Manual Service Updates**: On-demand service reference updates with a single click
- **C# Project Integration**: 
  - Debug C# projects directly from service reference files
  - Run C# projects with integrated terminal support
  - Automatic project discovery
- **Generate Initial Config**: Create `dotnet-svcutil.params.json` files with guided setup
- **Smart CodeLens Buttons**: Context-aware inline buttons in service reference files
- **Progress Indication**: Real-time feedback during service reference generation
- **Output Channel**: Dedicated logging for all WSDL monitoring and service operations

## Requirements

- **.NET SDK**: Must have .NET SDK installed with `dotnet-svcutil` tool available
- **Workspace**: Requires an open VS Code workspace with SOAP projects containing `ServiceReference` folders

## Extension Settings

This extension contributes the following settings:

- `soapServiceReference.autoRun`: Enable/disable automatic running of dotnet-svcutil when params files change (default: `true`)
- `soapServiceReference.showNotifications`: Show success/error notifications when dotnet-svcutil runs (default: `true`)
- `soapServiceReference.autoUpdateOnWsdlChange`: Automatically update service references when WSDL changes are detected without asking (default: `false`)
- `soapServiceReference.wsdlCheckInterval`: Interval in seconds to check for WSDL changes, range 5-300 seconds (default: `30`)
- `soapServiceReference.showWsdlChangeDetails`: Show detailed information about WSDL changes in notifications (default: `true`)
- `soapServiceReference.enableWsdlMonitoringByDefault`: Automatically start WSDL monitoring when opening service reference files (default: `false`)

## Usage

### WSDL Monitoring Mode
1. Open a `dotnet-svcutil.params.json` file in the editor
2. Click `$(eye) Monitor WSDL Changes` to start monitoring the WSDL endpoints
3. The extension will check every 30 seconds for changes to the actual WSDL content
4. When changes are detected, you'll get a notification to update the service reference
5. Click `$(eye-closed) Stop WSDL Monitoring` to stop monitoring

### Manual Updates
1. Open a `dotnet-svcutil.params.json` file in the editor
2. Click `$(sync) Update Service Reference` to manually update from WSDL
3. Or use the Command Palette: `Ctrl+Shift+P` → "SOAP: Run dotnet-svcutil"

### C# Project Integration
1. In any `dotnet-svcutil.params.json` file, use the inline buttons:
   - `$(debug-start) Debug C# Project` - Start debugging the associated C# project
   - `$(play) Run C# Project` - Run the C# project in terminal
2. The extension automatically finds the `.csproj` file in the parent directory

### CodeLens Buttons
When viewing a `dotnet-svcutil.params.json` file, you'll see:
- **`$(sync) Update Service Reference`** - Manual service reference update
- **`$(eye) Monitor WSDL Changes`** / **`$(eye-closed) Stop WSDL Monitoring`** - Toggle WSDL monitoring
- **`$(debug-start) Debug C# Project`** - Start debugging
- **`$(play) Run C# Project`** - Run project
- **`$(sync~spin) Running...`** - Shows when operation is in progress

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

- `SOAP: Run dotnet-svcutil` - Manually update service reference from WSDL
- `SOAP: Generate dotnet-svcutil.params.json` - Create a new params file with guided setup
- `SOAP: Start WSDL Monitoring` - Begin monitoring WSDL endpoints for changes
- `SOAP: Stop WSDL Monitoring` - Stop WSDL endpoint monitoring
- `SOAP: Debug C# Project` - Start debugging the associated C# project
- `SOAP: Run C# Project` - Run the C# project in terminal
- `SOAP: Setup File Watchers` - Configure legacy file watching (deprecated)

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
