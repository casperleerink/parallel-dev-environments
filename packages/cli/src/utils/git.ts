export async function createWorktree(
	repoPath: string,
	branch: string,
	worktreePath: string,
): Promise<void> {
	// Try checking out existing branch first
	const proc = Bun.spawn(
		["git", "-C", repoPath, "worktree", "add", worktreePath, branch],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const exitCode = await proc.exited;
	if (exitCode === 0) return;

	// Branch doesn't exist — create it as a new branch
	const procNew = Bun.spawn(
		["git", "-C", repoPath, "worktree", "add", "-b", branch, worktreePath],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const exitCodeNew = await procNew.exited;
	if (exitCodeNew !== 0) {
		const stderr = await new Response(procNew.stderr).text();
		throw new Error(`Failed to create worktree: ${stderr.trim()}`);
	}
}

export async function removeWorktree(
	repoPath: string,
	worktreePath: string,
): Promise<void> {
	const proc = Bun.spawn(
		["git", "-C", repoPath, "worktree", "remove", worktreePath, "--force"],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`Failed to remove worktree: ${stderr.trim()}`);
	}
}

export async function listBranches(repoPath: string): Promise<string[]> {
	const proc = Bun.spawn(
		["git", "-C", repoPath, "branch", "--format=%(refname:short)"],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text();
		throw new Error(`Failed to list branches: ${stderr.trim()}`);
	}
	const stdout = await new Response(proc.stdout).text();
	return stdout
		.trim()
		.split("\n")
		.filter((b) => b.length > 0);
}
