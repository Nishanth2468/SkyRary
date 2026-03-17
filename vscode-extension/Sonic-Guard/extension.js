const vscode = require('vscode');
const http = require('http');

function activate(context) {

    console.log("Sonic Guard extension activated");

    const command = vscode.commands.registerCommand('sonic-guard.scanRepo', () => {

        const folders = vscode.workspace.workspaceFolders;

        if (!folders) {
            vscode.window.showErrorMessage("Open a repository folder first.");
            return;
        }

        const repoPath = folders[0].uri.fsPath;

        vscode.window.showInformationMessage("Sonic Guard scanning repository...");

        const data = JSON.stringify({ repo: repoPath });

        const options = {
            hostname: "localhost",
            port: 8000,
            path: "/api/webapp/review",
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Content-Length": data.length
            }
        };

        const req = http.request(options, (res) => {

            let body = "";

            res.on("data", chunk => {
                body += chunk;
            });

            res.on("end", () => {

                try {

                    const findings = JSON.parse(body);

                    vscode.window.showInformationMessage(
                        "Scan complete: " + findings.length + " issues detected."
                    );

                } catch (err) {

                    vscode.window.showErrorMessage("Invalid backend response.");

                }

            });

        });

        req.on("error", () => {
            vscode.window.showErrorMessage("Cannot connect to Sonic Guard backend.");
        });

        req.write(data);
        req.end();

    });

    context.subscriptions.push(command);
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};