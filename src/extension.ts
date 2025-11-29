// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

let outputChannel: vscode.OutputChannel;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('SOAP Service Reference Auto-Runner');
	outputChannel.appendLine('Extension activated');

	// Register manual command to run dotnet-svcutil
	const runSvcUtilCommand = vscode.commands.registerCommand('soap-service-reference-auto-runner.runSvcUtil', async () => {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			const fileUri = activeEditor.document.uri;
			if (fileUri.fsPath.endsWith('dotnet-svcutil.params.json')) {
				await runDotnetSvcUtil(fileUri);
			} else {
				vscode.window.showWarningMessage('Please open a dotnet-svcutil.params.json file to run this command.');
			}
		} else {
			vscode.window.showWarningMessage('No active editor found. Please open a dotnet-svcutil.params.json file.');
		}
	});

	// Register command to generate initial svc params file
	const generateSvcParamsCommand = vscode.commands.registerCommand('soap-service-reference-auto-runner.generateSvcParams', async () => {
		await generateSvcParamsFile();
	});

	// Register command to setup file watchers with directory selection
	const setupWatchersCommand = vscode.commands.registerCommand('soap-service-reference-auto-runner.setupWatchers', async () => {
		await setupWatchersWithSelection(context);
	});

	// Setup file watchers for all workspace folders
	setupFileWatchers(context);

	context.subscriptions.push(runSvcUtilCommand, generateSvcParamsCommand, setupWatchersCommand, outputChannel);
}

function setupFileWatchers(context: vscode.ExtensionContext) {
	if (!vscode.workspace.workspaceFolders) {
		outputChannel.appendLine('No workspace folders found');
		return;
	}

	vscode.workspace.workspaceFolders.forEach(workspaceFolder => {
		// Watch for dotnet-svcutil.params.json files in ServiceReference folders
		const pattern = new vscode.RelativePattern(workspaceFolder, '**/ServiceReference/dotnet-svcutil.params.json');
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);

		watcher.onDidChange(uri => {
			outputChannel.appendLine(`Detected change in: ${uri.fsPath}`);
			runDotnetSvcUtil(uri);
		});

		watcher.onDidCreate(uri => {
			outputChannel.appendLine(`Detected creation of: ${uri.fsPath}`);
			runDotnetSvcUtil(uri);
		});

		context.subscriptions.push(watcher);
		outputChannel.appendLine(`File watcher setup for workspace: ${workspaceFolder.name}`);
	});
}

async function runDotnetSvcUtil(paramFileUri: vscode.Uri): Promise<void> {
	const config = vscode.workspace.getConfiguration('soapServiceReference');
	const autoRun = config.get<boolean>('autoRun', true);
	const showNotifications = config.get<boolean>('showNotifications', true);

	if (!autoRun) {
		outputChannel.appendLine('Auto-run is disabled in settings');
		return;
	}

	const paramFilePath = paramFileUri.fsPath;
	const serviceReferenceDir = path.dirname(paramFilePath);
	const projectDir = path.dirname(serviceReferenceDir);

	outputChannel.appendLine(`Running dotnet-svcutil for: ${paramFilePath}`);
	outputChannel.show(true);

	// Check if the params file exists and parse it
	let parsedParams: any;
	try {
		const paramContent = fs.readFileSync(paramFilePath, 'utf8');
		parsedParams = JSON.parse(paramContent);
	} catch (error) {
		outputChannel.appendLine(`Error reading params file: ${error}`);
		vscode.window.showErrorMessage(`Invalid dotnet-svcutil.params.json file: ${error}`);
		return;
	}

	// Build command arguments from parsed parameters
	const args = ['svcutil'];
	const options = parsedParams.options || {};

	// Add inputs (WSDL URLs or files)
	if (options.inputs && Array.isArray(options.inputs)) {
		args.push(...options.inputs);
	}

	// Add namespace mappings
	if (options.namespaceMappings && Array.isArray(options.namespaceMappings)) {
		options.namespaceMappings.forEach((mapping: string) => {
			args.push('-n');
			args.push(mapping);
		});
	}

	// Add output file
	if (options.outputFile) {
		args.push('-o');
		args.push(options.outputFile);
	}

	// Add target framework
	if (options.targetFramework) {
		args.push('-tf');
		args.push(options.targetFramework);
	}

	// Handle type reuse mode - if "All" then don't add -ntr, otherwise add it
	if (options.typeReuseMode && options.typeReuseMode !== 'All') {
		args.push('-ntr');
	}

	// Add references
	if (options.references && Array.isArray(options.references)) {
		options.references.forEach((reference: string) => {
			args.push('-r');
			args.push(reference);
		});
	}

	outputChannel.appendLine(`Executing: dotnet ${args.join(' ')}`);

	// Show progress indication
	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: 'Running dotnet-svcutil',
		cancellable: false
	}, async (progress) => {
		progress.report({ increment: 0, message: 'Starting...' });

		return new Promise<void>((resolve, reject) => {
			// Run dotnet-svcutil command with parsed arguments
			const dotnetProcess = spawn('dotnet', args, {
				cwd: serviceReferenceDir, // Run in ServiceReference directory for correct output path
				shell: false,
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let stdout = '';
			let stderr = '';

			dotnetProcess.stdout?.on('data', (data) => {
				const output = data.toString();
				stdout += output;
				outputChannel.append(output);
				progress.report({ increment: 10, message: 'Processing...' });
			});

			dotnetProcess.stderr?.on('data', (data) => {
				const error = data.toString();
				stderr += error;
				outputChannel.append(error);
			});

			dotnetProcess.on('close', (code) => {
				if (code === 0) {
					outputChannel.appendLine(`dotnet-svcutil completed successfully`);
					if (showNotifications) {
						vscode.window.showInformationMessage('SOAP service reference updated successfully');
					}
					progress.report({ increment: 100, message: 'Completed' });
				} else {
					outputChannel.appendLine(`dotnet-svcutil failed with code: ${code}`);
					if (showNotifications) {
						vscode.window.showErrorMessage(`dotnet-svcutil failed with exit code ${code}. Check output for details.`);
					}
				}
				resolve();
			});

			dotnetProcess.on('error', (error) => {
				outputChannel.appendLine(`Error spawning dotnet process: ${error.message}`);
				vscode.window.showErrorMessage(`Failed to run dotnet-svcutil: ${error.message}`);
				reject(error);
			});
		});
	});
}

async function generateSvcParamsFile(): Promise<void> {
	// Get WSDL URL from user
	const wsdlUrl = await vscode.window.showInputBox({
		prompt: 'Enter the WSDL URL',
		placeHolder: 'http://localhost:5000/Service.asmx?wsdl',
		validateInput: (value) => {
			if (!value || !value.trim()) {
				return 'WSDL URL is required';
			}
			try {
				new URL(value);
				return null;
			} catch {
				return 'Please enter a valid URL';
			}
		}
	});

	if (!wsdlUrl) {
		return;
	}

	// Get namespace from user
	const namespace = await vscode.window.showInputBox({
		prompt: 'Enter the namespace for generated code',
		placeHolder: 'ServiceReference',
		value: 'ServiceReference'
	});

	if (!namespace) {
		return;
	}

	// Select target directory
	const targetDir = await selectTargetDirectory();
	if (!targetDir) {
		return;
	}

	// Create ServiceReference directory if it doesn't exist
	const serviceRefDir = path.join(targetDir.fsPath, 'ServiceReference');
	if (!fs.existsSync(serviceRefDir)) {
		fs.mkdirSync(serviceRefDir, { recursive: true });
	}

	// Get target framework
	const targetFramework = await vscode.window.showQuickPick([
		'net9.0', 'net8.0', 'net7.0', 'net6.0', 'netstandard2.1', 'netstandard2.0'
	], {
		placeHolder: 'Select target framework',
		canPickMany: false
	});

	if (!targetFramework) {
		return;
	}

	// Create params file content
	const paramsContent = {
		"providerId": "Microsoft.Tools.ServiceModel.Svcutil",
		"version": "8.0.0",
		"options": {
			"inputs": [wsdlUrl],
			"namespaceMappings": [`*, ${namespace}`],
			"outputFile": "Reference.cs",
			"references": [
				"Microsoft.Extensions.ObjectPool, {Microsoft.Extensions.ObjectPool, 8.0.10}",
				"System.Security.Cryptography.Pkcs, {System.Security.Cryptography.Pkcs, 8.0.1}",
				"System.Security.Cryptography.Xml, {System.Security.Cryptography.Xml, 8.0.2}"
			],
			"targetFramework": targetFramework,
			"typeReuseMode": "All"
		}
	};

	const paramsFilePath = path.join(serviceRefDir, 'dotnet-svcutil.params.json');
	fs.writeFileSync(paramsFilePath, JSON.stringify(paramsContent, null, 2));

	// Open the created file
	const document = await vscode.workspace.openTextDocument(paramsFilePath);
	await vscode.window.showTextDocument(document);

	outputChannel.appendLine(`Created dotnet-svcutil.params.json at: ${paramsFilePath}`);
	vscode.window.showInformationMessage('dotnet-svcutil.params.json file created successfully!');
}

async function selectTargetDirectory(): Promise<vscode.Uri | undefined> {
	if (!vscode.workspace.workspaceFolders) {
		vscode.window.showErrorMessage('No workspace folder is open');
		return undefined;
	}

	if (vscode.workspace.workspaceFolders.length === 1) {
		return vscode.workspace.workspaceFolders[0].uri;
	}

	// Multiple workspace folders - let user choose
	const folderItems = vscode.workspace.workspaceFolders.map(folder => ({
		label: folder.name,
		description: folder.uri.fsPath,
		folder: folder
	}));

	const selected = await vscode.window.showQuickPick(folderItems, {
		placeHolder: 'Select target workspace folder for the ServiceReference'
	});

	return selected?.folder.uri;
}

async function setupWatchersWithSelection(context: vscode.ExtensionContext): Promise<void> {
	if (!vscode.workspace.workspaceFolders) {
		vscode.window.showErrorMessage('No workspace folders found');
		return;
	}

	// Find all directories with .csproj files (potential project directories)
	const projectDirs: { label: string; description: string; uri: vscode.Uri }[] = [];

	for (const workspaceFolder of vscode.workspace.workspaceFolders) {
		const csprojFiles = await vscode.workspace.findFiles(
			new vscode.RelativePattern(workspaceFolder, '**/*.csproj'),
			new vscode.RelativePattern(workspaceFolder, '**/node_modules/**')
		);

		for (const csprojFile of csprojFiles) {
			const projectDir = path.dirname(csprojFile.fsPath);
			const projectName = path.basename(projectDir);
			projectDirs.push({
				label: projectName,
				description: projectDir,
				uri: vscode.Uri.file(projectDir)
			});
		}
	}

	if (projectDirs.length === 0) {
		vscode.window.showWarningMessage('No .csproj files found in workspace');
		return;
	}

	// Let user select which project directories to watch
	const selectedDirs = await vscode.window.showQuickPick(projectDirs, {
		placeHolder: 'Select project directories to watch for ServiceReference changes',
		canPickMany: true
	});

	if (!selectedDirs || selectedDirs.length === 0) {
		return;
	}

	// Setup watchers for selected directories
	selectedDirs.forEach(dirItem => {
		const pattern = new vscode.RelativePattern(dirItem.uri, 'ServiceReference/dotnet-svcutil.params.json');
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);

		watcher.onDidChange(uri => {
			outputChannel.appendLine(`Detected change in: ${uri.fsPath}`);
			runDotnetSvcUtil(uri);
		});

		watcher.onDidCreate(uri => {
			outputChannel.appendLine(`Detected creation of: ${uri.fsPath}`);
			runDotnetSvcUtil(uri);
		});

		context.subscriptions.push(watcher);
		outputChannel.appendLine(`File watcher setup for project: ${dirItem.label} (${dirItem.description})`);
	});

	vscode.window.showInformationMessage(`File watchers setup for ${selectedDirs.length} project(s)`);
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (outputChannel) {
		outputChannel.dispose();
	}
}
