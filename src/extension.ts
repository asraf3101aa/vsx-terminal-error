import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

let lastPlayTime = 0;

export function activate(context: vscode.ExtensionContext) {

	const getConfig = () =>
		vscode.workspace.getConfiguration('terminalErrorSound');

	const shouldPlay = (reason: 'task' | 'diagnostics' | 'debug') => {
		const config = getConfig();
		if (!config.get<boolean>('enabled', true)) return false;

		const cooldown = config.get<number>('cooldownMs', 1000);
		if (Date.now() - lastPlayTime < cooldown) return false;

		switch (reason) {
			case 'task':
				return config.get<boolean>('playOnTaskFailure', true);
			case 'diagnostics':
				return config.get<boolean>('playOnDiagnosticsError', false);
			case 'debug':
				return config.get<boolean>('playOnDebugFailure', false);
		}
	};

	// -------------------------
	// Commands
	// -------------------------

	context.subscriptions.push(

		vscode.commands.registerCommand('terminalErrorSound.enable', async () => {
			await getConfig().update('enabled', true, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage('Terminal Error Sound: ON');
		}),

		vscode.commands.registerCommand('terminalErrorSound.disable', async () => {
			await getConfig().update('enabled', false, vscode.ConfigurationTarget.Global);
			vscode.window.showInformationMessage('Terminal Error Sound: OFF');
		}),

		vscode.commands.registerCommand('terminalErrorSound.testSound', async () => {
			await playErrorSound(context);
		})
	);

	// -------------------------
	// Terminal command exit (requires shell integration)
	// -------------------------

	context.subscriptions.push(
		vscode.window.onDidEndTerminalShellExecution(async (event) => {
			if (!shouldPlay('task')) return;

			// Use official API if available
			if (event.exitCode !== undefined && event.exitCode !== 0) {
				await playErrorSound(context);
			}
		})
	);

	// -------------------------
	// Terminal close fallback
	// -------------------------

	context.subscriptions.push(
		vscode.window.onDidCloseTerminal(async (terminal) => {
			if (!shouldPlay('task')) return;

			if (terminal.exitStatus?.code && terminal.exitStatus.code !== 0) {
				await playErrorSound(context);
			}
		})
	);

	// -------------------------
	// Diagnostics
	// -------------------------

	const errorCounts = new Map<string, number>();

	context.subscriptions.push(
		vscode.languages.onDidChangeDiagnostics(async (event) => {
			if (!shouldPlay('diagnostics')) return;

			let shouldTrigger = false;

			for (const uri of event.uris) {
				const key = uri.toString();
				const diagnostics = vscode.languages.getDiagnostics(uri);
				const currentErrors =
					diagnostics.filter(d =>
						d.severity === vscode.DiagnosticSeverity.Error
					).length;

				const previousErrors = errorCounts.get(key) ?? 0;

				if (currentErrors > previousErrors) {
					shouldTrigger = true;
				}

				errorCounts.set(key, currentErrors);
			}

			if (shouldTrigger) {
				await playErrorSound(context);
			}
		})
	);

	// -------------------------
	// Debug exit
	// -------------------------

	context.subscriptions.push(
		vscode.debug.registerDebugAdapterTrackerFactory('*', {
			createDebugAdapterTracker() {
				return {
					onDidSendMessage: async (message) => {
						if (
							message.type === 'event' &&
							message.event === 'exited' &&
							message.body?.exitCode !== undefined &&
							message.body.exitCode !== 0 &&
							shouldPlay('debug')
						) {
							await playErrorSound(context);
						}
					}
				};
			}
		})
	);

	console.log('Terminal Error Sound extension is active.');
}

// =====================================================
// SOUND PLAYBACK
// =====================================================

async function playErrorSound(context: vscode.ExtensionContext) {

	const soundPath = resolveSoundPath(context);

	if (!soundPath) {
		process.stdout.write('\x07'); // system beep fallback
		return;
	}

	const played = await playWithSystem(soundPath);

	if (played) {
		lastPlayTime = Date.now();
	} else {
		process.stdout.write('\x07'); // fallback beep
	}
}

function resolveSoundPath(context: vscode.ExtensionContext): string | undefined {

	const homeDir = os.homedir();
	const soundDir = path.join(homeDir, '.vscode', 'sound');

	let candidates = [
		path.join(soundDir, 'terminal.error.wav'),
		path.join(soundDir, 'terminal.error.mp3'),
		path.join(soundDir, '.terminal.wav'),
		path.join(soundDir, '.terminal.mp3'),
		path.join(soundDir, 'terminal.wav'),
		path.join(soundDir, 'terminal.mp3'),
		path.join(context.extensionPath, 'assets', 'error.wav'),
		path.join(context.extensionPath, 'assets', 'error.mp3')
	];

	if (process.platform === 'win32') {
		candidates = candidates.filter(p => p.toLowerCase().endsWith('.wav'));
	}

	return candidates.find(p => fs.existsSync(p));
}

function playWithSystem(soundPath: string): Promise<boolean> {

	return new Promise((resolve) => {

		const platform = process.platform;

		let cmd: string;
		let args: string[];

		if (platform === 'darwin') {
			cmd = 'afplay';
			args = [soundPath];

		} else if (platform === 'linux') {
			// Try paplay first
			cmd = 'paplay';
			args = [soundPath];

		} else {
			// Windows: PowerShell using System.Media.SoundPlayer (no temp file)
			cmd = 'powershell';
			args = [
				'-NoProfile',
				'-NonInteractive',
				'-Command',
				`(New-Object System.Media.SoundPlayer '${soundPath.replace(/'/g, "''")}').PlaySync();`
			];
		}

		const proc = spawn(cmd, args, {
			stdio: 'ignore',
			windowsHide: true
		});

		proc.on('close', (code) => {
			if (code === 0) {
				resolve(true);
			} else if (platform === 'linux') {
				// fallback to aplay (WAV only)
				const fallback = spawn('aplay', [soundPath], { stdio: 'ignore' });
				fallback.on('close', c => resolve(c === 0));
				fallback.on('error', () => resolve(false));
			} else {
				resolve(false);
			}
		});

		proc.on('error', () => resolve(false));
	});
}

export function deactivate() { }