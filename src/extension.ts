import * as vscode from 'vscode';
import { TRNEditorProvider } from './trnEditorProvider';

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(TRNEditorProvider.register(context));
}

export function deactivate() {}
