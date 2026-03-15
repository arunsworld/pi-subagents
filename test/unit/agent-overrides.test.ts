import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { buildBuiltinOverrideConfig, discoverAgents, removeBuiltinAgentOverride } from "../../agents.ts";

let tempHome = "";
let tempProject = "";
const originalHome = process.env.HOME;

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

function writeProjectAgent(cwd: string, name: string, body: string): void {
	const filePath = path.join(cwd, ".pi", "agents", `${name}.md`);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, body, "utf-8");
}

describe("builtin agent overrides", () => {
	const builtinName = "report-generator";

	beforeEach(() => {
		tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-home-"));
		tempProject = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagents-project-"));
		process.env.HOME = tempHome;
	});

	afterEach(() => {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		fs.rmSync(tempHome, { recursive: true, force: true });
		fs.rmSync(tempProject, { recursive: true, force: true });
	});

	it("applies user settings overrides to builtin agents", () => {
		writeJson(path.join(tempHome, ".pi", "agent", "settings.json"), {
			subagents: {
				agentOverrides: {
					[builtinName]: {
						model: "openai/gpt-5.4",
						thinking: "xhigh",
					},
				},
			},
		});

		const agent = discoverAgents(tempProject, "both").agents.find((a) => a.name === builtinName);
		assert.ok(agent);
		assert.equal(agent.source, "builtin");
		assert.equal(agent.model, "openai/gpt-5.4");
		assert.equal(agent.thinking, "xhigh");
		assert.equal(agent.override?.scope, "user");
		assert.equal(agent.override?.path, path.join(tempHome, ".pi", "agent", "settings.json"));
	});

	it("prefers project settings overrides over user settings overrides", () => {
		fs.mkdirSync(path.join(tempProject, ".pi"), { recursive: true });
		writeJson(path.join(tempHome, ".pi", "agent", "settings.json"), {
			subagents: { agentOverrides: { [builtinName]: { model: "openai/gpt-5.4" } } },
		});
		writeJson(path.join(tempProject, ".pi", "settings.json"), {
			subagents: { agentOverrides: { [builtinName]: { model: "openai-codex/gpt-5.4-mini", thinking: "high" } } },
		});

		const agent = discoverAgents(tempProject, "both").agents.find((a) => a.name === builtinName);
		assert.ok(agent);
		assert.equal(agent.model, "openai-codex/gpt-5.4-mini");
		assert.equal(agent.thinking, "high");
		assert.equal(agent.override?.scope, "project");
		assert.equal(agent.override?.path, path.join(tempProject, ".pi", "settings.json"));
	});

	it("does not apply project settings overrides when scope is user", () => {
		fs.mkdirSync(path.join(tempProject, ".pi"), { recursive: true });
		writeJson(path.join(tempHome, ".pi", "agent", "settings.json"), {
			subagents: { agentOverrides: { [builtinName]: { model: "openai/gpt-5.4" } } },
		});
		writeJson(path.join(tempProject, ".pi", "settings.json"), {
			subagents: { agentOverrides: { [builtinName]: { model: "openai-codex/gpt-5.4-mini" } } },
		});

		const agent = discoverAgents(tempProject, "user").agents.find((a) => a.name === builtinName);
		assert.ok(agent);
		assert.equal(agent.model, "openai/gpt-5.4");
		assert.equal(agent.override?.scope, "user");
	});

	it("does not apply user settings overrides when scope is project", () => {
		fs.mkdirSync(path.join(tempProject, ".pi"), { recursive: true });
		writeJson(path.join(tempHome, ".pi", "agent", "settings.json"), {
			subagents: { agentOverrides: { [builtinName]: { model: "openai/gpt-5.4" } } },
		});

		const agent = discoverAgents(tempProject, "project").agents.find((a) => a.name === builtinName);
		assert.ok(agent);
		assert.notEqual(agent.model, "openai/gpt-5.4");
		assert.equal(agent.override, undefined);
	});

	it("does not read malformed out-of-scope settings files", () => {
		fs.mkdirSync(path.join(tempProject, ".pi"), { recursive: true });
		fs.mkdirSync(path.join(tempHome, ".pi", "agent"), { recursive: true });
		fs.writeFileSync(path.join(tempHome, ".pi", "agent", "settings.json"), '{"subagents":', "utf-8");
		writeJson(path.join(tempProject, ".pi", "settings.json"), {
			subagents: { agentOverrides: { [builtinName]: { model: "openai-codex/gpt-5.4-mini" } } },
		});

		const agent = discoverAgents(tempProject, "project").agents.find((a) => a.name === builtinName);
		assert.ok(agent);
		assert.equal(agent.model, "openai-codex/gpt-5.4-mini");
		assert.equal(agent.override?.scope, "project");
	});

	it("does not apply builtin settings overrides when a full project agent overrides the builtin", () => {
		fs.mkdirSync(path.join(tempProject, ".pi"), { recursive: true });
		writeJson(path.join(tempProject, ".pi", "settings.json"), {
			subagents: { agentOverrides: { [builtinName]: { model: "openai/gpt-5.4" } } },
		});
		writeProjectAgent(
			tempProject,
			builtinName,
			`---\nname: ${builtinName}\ndescription: Project report generator\nmodel: google/gemini-3-pro\n---\n\nUse the project report generator.\n`,
		);

		const agent = discoverAgents(tempProject, "both").agents.find((a) => a.name === builtinName);
		assert.ok(agent);
		assert.equal(agent.source, "project");
		assert.equal(agent.model, "google/gemini-3-pro");
		assert.equal(agent.override, undefined);
	});

	it("does not create a settings file when removing a non-existent override", () => {
		const settingsPath = path.join(tempHome, ".pi", "agent", "settings.json");
		assert.equal(fs.existsSync(settingsPath), false);
		removeBuiltinAgentOverride(tempProject, builtinName, "user");
		assert.equal(fs.existsSync(settingsPath), false);
	});

	it("surfaces malformed settings files instead of silently ignoring them", () => {
		const settingsPath = path.join(tempHome, ".pi", "agent", "settings.json");
		fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
		fs.writeFileSync(settingsPath, '{"subagents":', "utf-8");

		assert.throws(
			() => discoverAgents(tempProject, "both"),
			(error: unknown) => error instanceof Error
				&& error.message.includes(settingsPath)
				&& error.message.includes("Failed to parse settings file"),
		);
	});

	it("builds false sentinels when an override clears builtin fields", () => {
		const override = buildBuiltinOverrideConfig(
			{
				model: "openai-codex/gpt-5.4-mini",
				fallbackModels: ["openai/gpt-5-mini"],
				thinking: "high",
				systemPrompt: "Base prompt",
				skills: ["safe-bash"],
				tools: ["bash"],
				mcpDirectTools: ["xcodebuild_list_sims"],
			},
			{
				model: undefined,
				fallbackModels: undefined,
				thinking: undefined,
				systemPrompt: "Base prompt",
				skills: undefined,
				tools: undefined,
				mcpDirectTools: undefined,
			},
		);

		assert.deepEqual(override, {
			model: false,
			fallbackModels: false,
			thinking: false,
			skills: false,
			tools: false,
		});
	});
});
