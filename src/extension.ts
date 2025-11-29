// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

let outputChannel: vscode.OutputChannel;
const recentlyCreatedFiles = new Set<string>();
const runningProcesses = new Set<string>();
const watchedFiles = new Set<string>();
const wsdlMonitors = new Map<string, NodeJS.Timeout>(); // file path -> interval
const wsdlHashes = new Map<string, string>(); // WSDL URL -> content hash

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	outputChannel = vscode.window.createOutputChannel('SOAP Service Reference Auto-Runner');
	outputChannel.appendLine('Extension activated');

	// Register manual command to run dotnet-svcutil
	const runSvcUtilCommand = vscode.commands.registerCommand('soap-service-reference-auto-runner.runSvcUtil', async (uri?: vscode.Uri) => {
		let fileUri: vscode.Uri | undefined = uri;
		
		if (!fileUri) {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor) {
				fileUri = activeEditor.document.uri;
			}
		}

		if (fileUri && fileUri.fsPath.endsWith('dotnet-svcutil.params.json')) {
			await runDotnetSvcUtil(fileUri);
		} else {
			vscode.window.showWarningMessage('Please open a dotnet-svcutil.params.json file to run this command.');
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

	// Register WSDL monitoring commands
	const startWsdlMonitoringCommand = vscode.commands.registerCommand('soap-service-reference-auto-runner.startWsdlMonitoring', async (uri?: vscode.Uri) => {
		await startWsdlMonitoring(uri);
	});

	const stopWsdlMonitoringCommand = vscode.commands.registerCommand('soap-service-reference-auto-runner.stopWsdlMonitoring', async (uri?: vscode.Uri) => {
		await stopWsdlMonitoring(uri);
	});

	// Register C# project integration commands
	const debugProjectCommand = vscode.commands.registerCommand('soap-service-reference-auto-runner.debugProject', async (uri?: vscode.Uri) => {
		await debugCSharpProject(uri);
	});

	const runProjectCommand = vscode.commands.registerCommand('soap-service-reference-auto-runner.runProject', async (uri?: vscode.Uri) => {
		await runCSharpProject(uri);
	});

	// Setup file watchers for all workspace folders
	setupFileWatchers(context);

	// Setup editor decorations for svc JSON files
	setupEditorDecorations(context);

	context.subscriptions.push(
		runSvcUtilCommand, 
		generateSvcParamsCommand, 
		setupWatchersCommand, 
		startWsdlMonitoringCommand,
		stopWsdlMonitoringCommand,
		debugProjectCommand,
		runProjectCommand,
		outputChannel
	);
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
			watchedFiles.add(uri.fsPath);
			refreshCodeLens();
			runDotnetSvcUtil(uri);
		});

		watcher.onDidCreate(uri => {
			outputChannel.appendLine(`Detected creation of: ${uri.fsPath}`);
			watchedFiles.add(uri.fsPath);
			refreshCodeLens();
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

	// Skip if this file was recently created by the extension
	if (recentlyCreatedFiles.has(paramFileUri.fsPath)) {
		outputChannel.appendLine('Skipping auto-run for recently created file');
		return;
	}

	// Skip if process is already running for this file
	if (runningProcesses.has(paramFileUri.fsPath)) {
		outputChannel.appendLine('Skipping - dotnet-svcutil is already running for this file');
		return;
	}

	if (!autoRun) {
		outputChannel.appendLine('Auto-run is disabled in settings');
		return;
	}

	const paramFilePath = paramFileUri.fsPath;
	const serviceReferenceDir = path.dirname(paramFilePath);
	const projectDir = path.dirname(serviceReferenceDir);

	// Mark process as running
	runningProcesses.add(paramFileUri.fsPath);
	refreshCodeLens();

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

	// Remove existing output file if it exists to prevent overwrite errors
	const outputFileName = options.outputFile || 'Reference.cs';
	const existingOutputFile = path.join(serviceReferenceDir, outputFileName);
	if (fs.existsSync(existingOutputFile)) {
		try {
			fs.unlinkSync(existingOutputFile);
			outputChannel.appendLine(`Removed existing file: ${existingOutputFile}`);
		} catch (error) {
			outputChannel.appendLine(`Warning: Could not remove existing file: ${error}`);
		}
	}

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

	// Add output directory to prevent subdirectory creation
	args.push('-d');
	args.push('.');

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
				// Clear running process tracking
				runningProcesses.delete(paramFileUri.fsPath);
				refreshCodeLens();
				
				if (code === 0) {
					outputChannel.appendLine(`dotnet-svcutil completed successfully`);
					if (showNotifications) {
						// Show auto-dismissing success notification
						vscode.window.withProgress({
							location: vscode.ProgressLocation.Notification,
							title: '✅ Service reference updated successfully',
							cancellable: false
						}, async () => {
							await new Promise(resolve => setTimeout(resolve, 3000)); // Show for 3 seconds
						});
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
				// Clear running process tracking on error
				runningProcesses.delete(paramFileUri.fsPath);
				refreshCodeLens();
				
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

	// Determine the correct ServiceReference directory
	let serviceRefDir: string;
	if (path.basename(targetDir.fsPath) === 'ServiceReference') {
		// Already in a ServiceReference folder
		serviceRefDir = targetDir.fsPath;
	} else {
		// Need to create ServiceReference subfolder
		serviceRefDir = path.join(targetDir.fsPath, 'ServiceReference');
		if (!fs.existsSync(serviceRefDir)) {
			fs.mkdirSync(serviceRefDir, { recursive: true });
		}
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

	// Mark this file as recently created to prevent immediate auto-execution
	recentlyCreatedFiles.add(paramsFilePath);
	setTimeout(() => {
		recentlyCreatedFiles.delete(paramsFilePath);
	}, 3000); // 3 second delay

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

	// Build a list of potential target directories
	const folderItems: { label: string; description: string; folder: vscode.Uri }[] = [];

	// Add workspace folders
	for (const workspaceFolder of vscode.workspace.workspaceFolders) {
		folderItems.push({
			label: `${workspaceFolder.name}`,
			description: workspaceFolder.uri.fsPath,
			folder: workspaceFolder.uri
		});

		// Look for existing ServiceReference folders
		const serviceRefPattern = new vscode.RelativePattern(workspaceFolder, '**/ServiceReference');
		try {
			const serviceRefFolders = await vscode.workspace.findFiles(serviceRefPattern, '**/node_modules/**');
			// Note: findFiles doesn't find folders, so let's check for existing params files to find ServiceReference folders
			const paramsFiles = await vscode.workspace.findFiles(
				new vscode.RelativePattern(workspaceFolder, '**/ServiceReference/dotnet-svcutil.params.json')
			);
			
			for (const paramsFile of paramsFiles) {
				const serviceRefDir = path.dirname(paramsFile.fsPath);
				folderItems.push({
					label: `🔧 ServiceReference (${path.basename(path.dirname(serviceRefDir))})`,
					description: serviceRefDir,
					folder: vscode.Uri.file(serviceRefDir)
				});
			}
		} catch (error) {
			// Ignore errors in folder discovery
		}
	}

	if (folderItems.length === 1) {
		return folderItems[0].folder;
	}

	const selected = await vscode.window.showQuickPick(folderItems, {
		placeHolder: 'Select target directory for the ServiceReference (existing ServiceReference folders will be updated)'
	});

	return selected?.folder;
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
			watchedFiles.add(uri.fsPath);
			refreshCodeLens();
			runDotnetSvcUtil(uri);
		});

		watcher.onDidCreate(uri => {
			outputChannel.appendLine(`Detected creation of: ${uri.fsPath}`);
			watchedFiles.add(uri.fsPath);
			refreshCodeLens();
			runDotnetSvcUtil(uri);
		});

		context.subscriptions.push(watcher);
		outputChannel.appendLine(`File watcher setup for project: ${dirItem.label} (${dirItem.description})`);
	});

	vscode.window.showInformationMessage(`File watchers setup for ${selectedDirs.length} project(s)`);
}

class SvcUtilCodeLensProvider implements vscode.CodeLensProvider {
	private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
	public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

	refresh(): void {
		this._onDidChangeCodeLenses.fire();
	}

	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		if (!document.fileName.endsWith('dotnet-svcutil.params.json')) {
			return [];
		}

		const codeLenses: vscode.CodeLens[] = [];
		const text = document.getText();
		const lines = text.split('\n');
		const filePath = document.uri.fsPath;

		// Find the line with "inputs" to place the buttons
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes('"inputs"')) {
				const line = document.lineAt(i);
				const range = new vscode.Range(line.range.start, line.range.start);
				
				const isRunning = runningProcesses.has(filePath);
				const isWatched = watchedFiles.has(filePath);
				
				const isMonitoring = wsdlMonitors.has(filePath);
				
				if (isRunning) {
					// Show running state - disabled
					const runningCommand: vscode.Command = {
						title: '$(sync~spin) Running...',
						command: '',
						tooltip: 'dotnet-svcutil is currently running'
					};
					codeLenses.push(new vscode.CodeLens(range, runningCommand));
				} else {
					// Main action buttons
					const updateCommand: vscode.Command = {
						title: '$(sync) Update Service Reference',
						command: 'soap-service-reference-auto-runner.runSvcUtil',
						arguments: [document.uri],
						tooltip: 'Update service reference from WSDL'
					};
					codeLenses.push(new vscode.CodeLens(range, updateCommand));
					
					// WSDL monitoring toggle
					const monitorRange = new vscode.Range(line.range.start.translate(0, 1), line.range.start.translate(0, 1));
					if (isMonitoring) {
						const stopMonitorCommand: vscode.Command = {
							title: '$(eye-closed) Stop WSDL Monitoring',
							command: 'soap-service-reference-auto-runner.stopWsdlMonitoring',
							arguments: [document.uri],
							tooltip: 'Stop monitoring WSDL for changes'
						};
						codeLenses.push(new vscode.CodeLens(monitorRange, stopMonitorCommand));
					} else {
						const startMonitorCommand: vscode.Command = {
							title: '$(eye) Monitor WSDL Changes',
							command: 'soap-service-reference-auto-runner.startWsdlMonitoring',
							arguments: [document.uri],
							tooltip: 'Start monitoring WSDL endpoints for changes'
						};
						codeLenses.push(new vscode.CodeLens(monitorRange, startMonitorCommand));
					}
					
					// C# project integration buttons
					const debugRange = new vscode.Range(line.range.start.translate(0, 2), line.range.start.translate(0, 2));
					const debugCommand: vscode.Command = {
						title: '$(debug-start) Debug C# Project',
						command: 'soap-service-reference-auto-runner.debugProject',
						arguments: [document.uri],
						tooltip: 'Start debugging the C# project'
					};
					codeLenses.push(new vscode.CodeLens(debugRange, debugCommand));
					
					const runRange = new vscode.Range(line.range.start.translate(0, 3), line.range.start.translate(0, 3));
					const runProjectCommand: vscode.Command = {
						title: '$(play) Run C# Project',
						command: 'soap-service-reference-auto-runner.runProject',
						arguments: [document.uri],
						tooltip: 'Run the C# project'
					};
					codeLenses.push(new vscode.CodeLens(runRange, runProjectCommand));
				}
				break;
			}
		}

		return codeLenses;
	}
}

let codeLensProvider: SvcUtilCodeLensProvider;

function refreshCodeLens() {
	if (codeLensProvider) {
		codeLensProvider.refresh();
	}
}

function setupEditorDecorations(context: vscode.ExtensionContext) {
	// Register the CodeLens provider
	codeLensProvider = new SvcUtilCodeLensProvider();
	const disposable = vscode.languages.registerCodeLensProvider(
		{ pattern: '**/dotnet-svcutil.params.json' },
		codeLensProvider
	);

	// Auto-start monitoring when opening service reference files
	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor && editor.document.fileName.endsWith('dotnet-svcutil.params.json')) {
			checkAutoStartMonitoring(editor.document.uri);
		}
	}, null, context.subscriptions);

	// Check current active editor
	if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.fileName.endsWith('dotnet-svcutil.params.json')) {
		checkAutoStartMonitoring(vscode.window.activeTextEditor.document.uri);
	}

	context.subscriptions.push(disposable);
}

async function startWsdlMonitoring(uri?: vscode.Uri): Promise<void> {
	const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
	if (!fileUri || !fileUri.fsPath.endsWith('dotnet-svcutil.params.json')) {
		vscode.window.showWarningMessage('Please open a dotnet-svcutil.params.json file.');
		return;
	}

	try {
		const paramContent = fs.readFileSync(fileUri.fsPath, 'utf8');
		const parsedParams = JSON.parse(paramContent);
		const inputs = parsedParams.options?.inputs || [];
		
		if (inputs.length === 0) {
			vscode.window.showWarningMessage('No WSDL inputs found in the params file.');
			return;
		}

		// Store initial WSDL content hashes
		for (const wsdlUrl of inputs) {
			if (typeof wsdlUrl === 'string' && (wsdlUrl.startsWith('http://') || wsdlUrl.startsWith('https://'))) {
				try {
					const response = await fetch(wsdlUrl);
					const wsdlContent = await response.text();
					const hash = crypto.createHash('md5').update(wsdlContent).digest('hex');
					wsdlHashes.set(wsdlUrl, hash);
					outputChannel.appendLine(`Initial hash for ${wsdlUrl}: ${hash.substring(0, 8)}`);
				} catch (error) {
					outputChannel.appendLine(`Failed to fetch initial WSDL from ${wsdlUrl}: ${error}`);
				}
			}
		}

		// Get monitoring interval from settings
		const config = vscode.workspace.getConfiguration('soapServiceReference');
		const checkInterval = config.get<number>('wsdlCheckInterval', 30) * 1000;
		
		// Start monitoring interval
		const interval = setInterval(async () => {
			await checkWsdlChanges(fileUri, inputs);
		}, checkInterval);

		wsdlMonitors.set(fileUri.fsPath, interval);
		refreshCodeLens();
		
		outputChannel.appendLine(`Started WSDL monitoring for ${inputs.length} endpoint(s)`);
		vscode.window.showInformationMessage(`WSDL monitoring started for ${inputs.length} endpoint(s)`);
		
	} catch (error) {
		outputChannel.appendLine(`Error starting WSDL monitoring: ${error}`);
		vscode.window.showErrorMessage(`Failed to start WSDL monitoring: ${error}`);
	}
}

async function stopWsdlMonitoring(uri?: vscode.Uri): Promise<void> {
	const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
	if (!fileUri || !fileUri.fsPath.endsWith('dotnet-svcutil.params.json')) {
		vscode.window.showWarningMessage('Please open a dotnet-svcutil.params.json file.');
		return;
	}

	const interval = wsdlMonitors.get(fileUri.fsPath);
	if (interval) {
		clearInterval(interval);
		wsdlMonitors.delete(fileUri.fsPath);
		refreshCodeLens();
		
		outputChannel.appendLine(`Stopped WSDL monitoring for ${fileUri.fsPath}`);
		vscode.window.showInformationMessage('WSDL monitoring stopped');
	}
}

async function checkWsdlChanges(fileUri: vscode.Uri, inputs: string[]): Promise<void> {
	for (const wsdlUrl of inputs) {
		if (typeof wsdlUrl === 'string' && (wsdlUrl.startsWith('http://') || wsdlUrl.startsWith('https://'))) {
			try {
				const response = await fetch(wsdlUrl);
				const wsdlContent = await response.text();
				const newHash = crypto.createHash('md5').update(wsdlContent).digest('hex');
				const oldHash = wsdlHashes.get(wsdlUrl);

				if (oldHash && newHash !== oldHash) {
					const config = vscode.workspace.getConfiguration('soapServiceReference');
					const autoUpdate = config.get<boolean>('autoUpdateOnWsdlChange', false);
					const showDetails = config.get<boolean>('showWsdlChangeDetails', true);
					const showNotifications = config.get<boolean>('showNotifications', true);
					
					outputChannel.appendLine(`WSDL change detected for ${wsdlUrl}`);
					if (showDetails) {
						outputChannel.appendLine(`Old hash: ${oldHash.substring(0, 8)}, New hash: ${newHash.substring(0, 8)}`);
					}
					
					// Update hash
					wsdlHashes.set(wsdlUrl, newHash);
					
					if (autoUpdate) {
						// Auto-update without asking
						if (showNotifications) {
							// Show auto-dismissing notification
							const notification = vscode.window.withProgress({
								location: vscode.ProgressLocation.Notification,
								title: 'Auto-updating service reference...',
								cancellable: false
							}, async () => {
								await new Promise(resolve => setTimeout(resolve, 2000)); // Show for 2 seconds
							});
						}
						await runDotnetSvcUtil(fileUri);
					} else {
						// Ask user for confirmation with timeout
						const shortUrl = wsdlUrl.length > 50 ? wsdlUrl.substring(0, 47) + '...' : wsdlUrl;
						const message = showDetails ? 
							`WSDL change detected in ${shortUrl}` :
							'WSDL change detected';
							
						// Use showInformationMessage which auto-dismisses
							const action = await vscode.window.showInformationMessage(
								message,
								{ modal: false }, // Non-modal, will auto-dismiss
								'Update Now',
								'Ignore'
							);
							
							if (action === 'Update Now') {
								await runDotnetSvcUtil(fileUri);
							}
						}
					
					break; // Only process one change at a time
				}
			} catch (error) {
				outputChannel.appendLine(`Failed to check WSDL ${wsdlUrl}: ${error}`);
			}
		}
	}
}

async function debugCSharpProject(uri?: vscode.Uri): Promise<void> {
	const projectPath = await findCSharpProject(uri);
	if (!projectPath) {
		return;
	}

	try {
		// Use VS Code's debug API to start debugging
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectPath));
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('Project is not in a workspace folder');
			return;
		}

		// Start debugging with default .NET configuration
		const debugConfig = {
			name: 'Debug SOAP Client',
			type: 'coreclr',
			request: 'launch',
			program: '${workspaceFolder}/bin/Debug/net9.0/${workspaceFolderBasename}.dll',
			cwd: '${workspaceFolder}',
			stopAtEntry: false,
			console: 'integratedTerminal'
		};

		await vscode.debug.startDebugging(workspaceFolder, debugConfig);
		outputChannel.appendLine(`Started debugging C# project: ${path.basename(projectPath)}`);
		
	} catch (error) {
		outputChannel.appendLine(`Error starting debug: ${error}`);
		vscode.window.showErrorMessage(`Failed to start debugging: ${error}`);
	}
}

async function runCSharpProject(uri?: vscode.Uri): Promise<void> {
	const projectPath = await findCSharpProject(uri);
	if (!projectPath) {
		return;
	}

	try {
		const projectDir = path.dirname(projectPath);
		outputChannel.appendLine(`Running C# project: ${path.basename(projectPath)}`);
		outputChannel.show();

		// Use terminal to run dotnet run
		const terminal = vscode.window.createTerminal({
			name: 'SOAP Client',
			cwd: projectDir
		});
		
		terminal.sendText('dotnet run');
		terminal.show();
		
	} catch (error) {
		outputChannel.appendLine(`Error running project: ${error}`);
		vscode.window.showErrorMessage(`Failed to run project: ${error}`);
	}
}

async function checkAutoStartMonitoring(uri: vscode.Uri): Promise<void> {
	const config = vscode.workspace.getConfiguration('soapServiceReference');
	const enableByDefault = config.get<boolean>('enableWsdlMonitoringByDefault', false);
	
	if (enableByDefault && !wsdlMonitors.has(uri.fsPath)) {
		// Small delay to allow file to fully load
		setTimeout(async () => {
			try {
				await startWsdlMonitoring(uri);
				outputChannel.appendLine(`Auto-started WSDL monitoring for ${path.basename(uri.fsPath)}`);
			} catch (error) {
				outputChannel.appendLine(`Failed to auto-start monitoring: ${error}`);
			}
		}, 1000);
	}
}

async function findCSharpProject(uri?: vscode.Uri): Promise<string | undefined> {
	const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
	if (!fileUri) {
		vscode.window.showWarningMessage('No active file found');
		return undefined;
	}

	// Find the .csproj file in the parent directory of the ServiceReference folder
	const serviceRefDir = path.dirname(fileUri.fsPath);
	const projectDir = path.dirname(serviceRefDir);
	
	const files = fs.readdirSync(projectDir);
	const csprojFile = files.find(file => file.endsWith('.csproj'));
	
	if (!csprojFile) {
		vscode.window.showErrorMessage('No .csproj file found in project directory');
		return undefined;
	}

	return path.join(projectDir, csprojFile);
}

// This method is called when your extension is deactivated
export function deactivate() {
	// Clean up all WSDL monitoring intervals
	for (const interval of wsdlMonitors.values()) {
		clearInterval(interval);
	}
	wsdlMonitors.clear();
	wsdlHashes.clear();
	
	if (outputChannel) {
		outputChannel.dispose();
	}
}
