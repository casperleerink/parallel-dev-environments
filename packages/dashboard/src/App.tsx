import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type EnvironmentResponse,
	fetchProjects,
	type ProjectResponse,
	startEnvironment,
	stopEnvironment,
} from "./api/client.js";

export function App() {
	const queryClient = useQueryClient();

	const {
		data: projects,
		error,
		isPending,
	} = useQuery({
		queryKey: ["projects"],
		queryFn: fetchProjects,
		refetchInterval: 5000,
	});

	const startMutation = useMutation({
		mutationFn: startEnvironment,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
	});

	const stopMutation = useMutation({
		mutationFn: stopEnvironment,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
	});

	if (error) {
		return (
			<div style={styles.container}>
				<h1 style={styles.title}>devenv Dashboard</h1>
				<div style={styles.errorCard}>
					<p>Could not connect to API server.</p>
					<p style={styles.hint}>
						Run <code style={styles.code}>devenv dashboard</code> to start the
						API server.
					</p>
				</div>
			</div>
		);
	}

	if (isPending) {
		return (
			<div style={styles.container}>
				<h1 style={styles.title}>devenv Dashboard</h1>
				<p style={styles.hint}>Loading...</p>
			</div>
		);
	}

	if (!projects || projects.length === 0) {
		return (
			<div style={styles.container}>
				<h1 style={styles.title}>devenv Dashboard</h1>
				<div style={styles.emptyCard}>
					<p>No projects yet.</p>
					<p style={styles.hint}>
						Run{" "}
						<code style={styles.code}>devenv create --repo &lt;path&gt;</code>{" "}
						to create one.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div style={styles.container}>
			<h1 style={styles.title}>devenv Dashboard</h1>
			{projects.map((project) => (
				<ProjectCard
					key={project.id}
					project={project}
					onStart={(name) => startMutation.mutate(name)}
					onStop={(name) => stopMutation.mutate(name)}
					startingEnv={
						startMutation.isPending ? (startMutation.variables ?? null) : null
					}
					stoppingEnv={
						stopMutation.isPending ? (stopMutation.variables ?? null) : null
					}
				/>
			))}
			{(startMutation.error || stopMutation.error) && (
				<p style={styles.mutationError}>
					{(startMutation.error || stopMutation.error)?.message}
				</p>
			)}
		</div>
	);
}

function ProjectCard({
	project,
	onStart,
	onStop,
	startingEnv,
	stoppingEnv,
}: {
	project: ProjectResponse;
	onStart: (name: string) => void;
	onStop: (name: string) => void;
	startingEnv: string | null;
	stoppingEnv: string | null;
}) {
	return (
		<div style={styles.card}>
			<div style={styles.cardHeader}>
				<h2 style={styles.projectName}>{project.name}</h2>
				<span style={styles.repoPath}>{project.repoPath}</span>
			</div>
			{project.environments.length === 0 ? (
				<p style={styles.hint}>No environments</p>
			) : (
				project.environments.map((env) => (
					<EnvironmentRow
						key={env.id}
						env={env}
						onStart={onStart}
						onStop={onStop}
						isStarting={startingEnv === env.name}
						isStopping={stoppingEnv === env.name}
					/>
				))
			)}
		</div>
	);
}

function EnvironmentRow({
	env,
	onStart,
	onStop,
	isStarting,
	isStopping,
}: {
	env: EnvironmentResponse;
	onStart: (name: string) => void;
	onStop: (name: string) => void;
	isStarting: boolean;
	isStopping: boolean;
}) {
	const isRunning = env.status === "running";
	const isBusy = isStarting || isStopping;

	return (
		<div style={styles.envRow}>
			<div style={styles.envInfo}>
				<span
					style={{ color: isRunning ? "#22c55e" : "#6b7280", marginRight: 8 }}
				>
					{isRunning ? "\u25cf" : "\u25cb"}
				</span>
				<span style={styles.envName}>{env.name}</span>
				<span style={styles.envBranch}>{env.branch}</span>
				<span
					style={{
						color: isRunning ? "#22c55e" : "#9ca3af",
						marginLeft: 8,
						fontSize: 13,
					}}
				>
					{env.status}
				</span>
			</div>
			<div style={styles.envActions}>
				{env.portMappings.map((pm) => (
					<a
						key={pm.hostname}
						href={`http://${pm.hostname}`}
						target="_blank"
						rel="noopener noreferrer"
						style={styles.link}
					>
						{pm.hostname}
					</a>
				))}
				{isRunning ? (
					<button
						type="button"
						style={styles.stopButton}
						onClick={() => onStop(env.name)}
						disabled={isBusy}
					>
						{isStopping ? "Stopping..." : "Stop"}
					</button>
				) : (
					<button
						type="button"
						style={styles.startButton}
						onClick={() => onStart(env.name)}
						disabled={isBusy}
					>
						{isStarting ? "Starting..." : "Start"}
					</button>
				)}
			</div>
		</div>
	);
}

const styles: Record<string, React.CSSProperties> = {
	container: {
		maxWidth: 900,
		margin: "0 auto",
		padding: "40px 20px",
	},
	title: {
		fontSize: 28,
		fontWeight: 700,
		marginBottom: 32,
		color: "#f5f5f5",
	},
	card: {
		background: "#141414",
		border: "1px solid #262626",
		borderRadius: 12,
		padding: 24,
		marginBottom: 16,
	},
	cardHeader: {
		marginBottom: 16,
	},
	projectName: {
		fontSize: 18,
		fontWeight: 600,
		color: "#f5f5f5",
		marginBottom: 4,
	},
	repoPath: {
		fontSize: 13,
		color: "#6b7280",
	},
	envRow: {
		display: "flex",
		justifyContent: "space-between",
		alignItems: "center",
		padding: "12px 0",
		borderTop: "1px solid #1f1f1f",
	},
	envInfo: {
		display: "flex",
		alignItems: "center",
	},
	envName: {
		fontWeight: 500,
		marginRight: 12,
	},
	envBranch: {
		color: "#818cf8",
		fontSize: 13,
	},
	envActions: {
		display: "flex",
		alignItems: "center",
		gap: 12,
	},
	link: {
		color: "#60a5fa",
		fontSize: 13,
		textDecoration: "none",
	},
	startButton: {
		background: "#166534",
		color: "#e5e5e5",
		border: "none",
		borderRadius: 6,
		padding: "6px 16px",
		cursor: "pointer",
		fontSize: 13,
		fontWeight: 500,
	},
	stopButton: {
		background: "#7f1d1d",
		color: "#e5e5e5",
		border: "none",
		borderRadius: 6,
		padding: "6px 16px",
		cursor: "pointer",
		fontSize: 13,
		fontWeight: 500,
	},
	errorCard: {
		background: "#1c1917",
		border: "1px solid #44403c",
		borderRadius: 12,
		padding: 24,
	},
	emptyCard: {
		background: "#141414",
		border: "1px solid #262626",
		borderRadius: 12,
		padding: 24,
	},
	hint: {
		color: "#6b7280",
		fontSize: 14,
		marginTop: 8,
	},
	code: {
		background: "#262626",
		padding: "2px 6px",
		borderRadius: 4,
		fontSize: 13,
	},
	mutationError: {
		color: "#ef4444",
		fontSize: 14,
		marginTop: 12,
	},
};
