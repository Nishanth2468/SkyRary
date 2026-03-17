import * as vscode from 'vscode';
import axios from 'axios';

// 1. Extend Diagnostic to hold our AI's suggested code string
class SonicGuardDiagnostic extends vscode.Diagnostic {
    constructor(
        range: vscode.Range,
        message: string,
        severity: vscode.DiagnosticSeverity,
        public suggestedCode?: string
    ) {
        super(range, message, severity);
    }
}

// Global collection for our squiggly lines
const diagnosticCollection = vscode.languages.createDiagnosticCollection('sonic-guard');

export function activate(context: vscode.ExtensionContext) {
    console.log('Sonic Guard is now active!');

    // 2. Register the Code Review Command
    let disposable = vscode.commands.registerCommand('sonic-guard.reviewFile', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active file to review.');
            return;
        }

        const document = editor.document;
        const code = document.getText();
        const filename = document.fileName;

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Sonic Guard: Analyzing Code...",
            cancellable: false
        }, async (progress) => {
            try {
                // Send current file content to the FastAPI server
                const response = await axios.post('http://localhost:8000/api/vscode/review', {
                    code: code,
                    filename: filename
                });

                const findings = response.data;

                if (!findings || findings.length === 0) {
                    vscode.window.showInformationMessage('Sonic Guard: No issues found! 🚀');
                    diagnosticCollection.delete(document.uri);
                    return;
                }

                const diagnostics: vscode.Diagnostic[] = [];

                for (const finding of findings) {
                    // Try to map the finding line number.
                    const line = typeof finding.line === 'number' ? Math.max(0, finding.line - 1) : 0;
                    
                    // Create range for squiggly lines (covering the whole line)
                    const range = document.lineAt(line).range;

                    let severity = vscode.DiagnosticSeverity.Warning;
                    if (finding.severity && finding.severity.toLowerCase() === 'critical') {
                        severity = vscode.DiagnosticSeverity.Error;
                    }

                    const message = `[${finding.type}] ${finding.description}`;

                    // Use our custom Diagnostic that attaches the suggested code behind-the-scenes
                    const diagnostic = new SonicGuardDiagnostic(range, message, severity, finding.suggested_code);
                    diagnostic.source = 'Sonic-Guard';
                    diagnostic.code = finding.type;

                    diagnostics.push(diagnostic);
                }

                diagnosticCollection.set(document.uri, diagnostics);
                vscode.window.showWarningMessage(`Sonic Guard: Found ${findings.length} potential issues.`);

            } catch (error: any) {
                vscode.window.showErrorMessage(`Sonic Guard Error: Check if your FastAPI server is running on port 8000.`);
                console.error(error);
            }
        });
    });

    context.subscriptions.push(disposable);

    // 3. Register the Quick Fix Lightbulb Provider
    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('*', new SonicGuardActionProvider(), {
            providedCodeActionKinds: SonicGuardActionProvider.providedCodeActionKinds
        })
    );
}

// 4. The Action Provider that creates the "💡 Lightbulb" suggestions
export class SonicGuardActionProvider implements vscode.CodeActionProvider {
    public static readonly providedCodeActionKinds = [
        vscode.CodeActionKind.QuickFix
    ];

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range | vscode.Selection, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
        // Collect all 'Quick Fix' actions for Sonic-Guard diagnostics on this line
        const actions: vscode.CodeAction[] = [];

        for (const diagnostic of context.diagnostics) {
            // Check if it's our diagnostic and actually has suggested code
            if (diagnostic.source === 'Sonic-Guard') {
                const sonicDiag = diagnostic as SonicGuardDiagnostic;
                if (sonicDiag.suggestedCode) {
                    const fixAction = this.createFix(document, sonicDiag);
                    actions.push(fixAction);
                }
            }
        }
        return actions;
    }

    private createFix(document: vscode.TextDocument, diagnostic: SonicGuardDiagnostic): vscode.CodeAction {
        const title = `Apply Sonic Guard Fix: ${diagnostic.code || 'Auto-Correction'}`;
        const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
        
        // This tells VS Code what to actually do when the button is clicked
        action.edit = new vscode.WorkspaceEdit();
        // We replace the affected code range with the AI's suggested code string
        action.edit.replace(document.uri, diagnostic.range, diagnostic.suggestedCode!);
        
        action.diagnostics = [diagnostic];
        action.isPreferred = true; // Makes it glow blue / appear at the top!
        
        return action;
    }
}

export function deactivate() {
    diagnosticCollection.clear();
}
