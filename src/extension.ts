import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import playSound from 'play-sound';

const player = playSound();

export function activate(context: vscode.ExtensionContext) {
	// Default to enabled if not set
	let isEnabled = context.globalState.get<boolean>('terminal-error-sound.enabled', true);

	// Register toggle command
	const toggleDisposable = vscode.commands.registerCommand('terminal-error-sound.toggle', () => {
		isEnabled = !isEnabled;
		context.globalState.update('terminal-error-sound.enabled', isEnabled);
		vscode.window.showInformationMessage(`Terminal Error Sound: ${isEnabled ? 'ON' : 'OFF'}`);
	});

	// Listen for terminal shell execution termination (requires Shell Integration)
	const terminalDisposable = vscode.window.onDidEndTerminalShellExecution(async (event) => {
		if (!isEnabled) {
			return;
		}

		// If outcome is a failure (non-zero exit code)
		const execution = event.execution as any;
		if (execution.status && execution.status.code !== 0) {
			await playErrorSound(context);
		}
	});

	context.subscriptions.push(toggleDisposable, terminalDisposable);

	console.log('Terminal Error Sound extension is now active.');
}

async function playErrorSound(context: vscode.ExtensionContext) {
	const homeDir = os.homedir();

	// Check points as per requirements: ~/.vscode/sound/
	const soundDir = path.join(homeDir, '.vscode', 'sound');
	const possiblePaths = [
		path.join(soundDir, 'terminal.error.mp3'),
		path.join(soundDir, '.terminal.mp3'),
		path.join(soundDir, 'terminal.mp3'),
		path.join(context.extensionPath, 'assets', 'error.mp3')
	];

	let soundToPlay: string | undefined;

	for (const p of possiblePaths) {
		if (fs.existsSync(p)) {
			soundToPlay = p;
			break;
		}
	}

	if (soundToPlay) {
		try {
			player.play(soundToPlay, (err: any) => {
				if (err) {
					console.error('Error playing sound file: ', err);
					// Fallback to system beep if sound player fails
					process.stdout.write('\x07');
				}
			});
		} catch (e) {
			console.error('Failed to trigger sound playback: ', e);
			process.stdout.write('\x07');
		}
	} else {
		// Ultimate fallback: system beep
		process.stdout.write('\x07');
	}
}

export function deactivate() { }
