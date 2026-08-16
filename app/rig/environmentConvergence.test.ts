import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { buildEnvironmentConfig } from "./environmentConfig";
import { environmentMatchesConfig } from "./environmentConvergence";

type LiveEnvironment = Anthropic.Beta.Environments.BetaEnvironment;

// A live environment shaped exactly like buildEnvironmentConfig()'s output,
// plus the server-assigned fields a real `environments.create`/`retrieve`
// response carries.
function matchingLiveEnvironment(): LiveEnvironment {
  const config = buildEnvironmentConfig();
  const desiredConfig = config.config;
  if (
    desiredConfig?.type !== "cloud" ||
    desiredConfig.networking?.type !== "limited"
  ) {
    throw new Error("expected a cloud config with limited networking");
  }

  return {
    id: "env_test",
    archived_at: null,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    metadata: {},
    name: config.name,
    description: config.description ?? "",
    type: "environment",
    config: {
      type: "cloud",
      networking: {
        type: "limited",
        allow_mcp_servers: desiredConfig.networking.allow_mcp_servers ?? false,
        allow_package_managers:
          desiredConfig.networking.allow_package_managers ?? false,
        allowed_hosts: desiredConfig.networking.allowed_hosts ?? [],
      },
      packages: {
        apt: desiredConfig.packages?.apt ?? [],
        cargo: desiredConfig.packages?.cargo ?? [],
        gem: desiredConfig.packages?.gem ?? [],
        go: desiredConfig.packages?.go ?? [],
        npm: desiredConfig.packages?.npm ?? [],
        pip: desiredConfig.packages?.pip ?? [],
      },
    },
  };
}

describe("environmentMatchesConfig", () => {
  it("matches an unchanged environment", () => {
    expect(
      environmentMatchesConfig(
        matchingLiveEnvironment(),
        buildEnvironmentConfig(),
      ),
    ).toBe(true);
  });

  it("detects a name change", () => {
    const live = matchingLiveEnvironment();
    live.name = "Something Else";
    expect(environmentMatchesConfig(live, buildEnvironmentConfig())).toBe(
      false,
    );
  });

  it("detects a description change", () => {
    const live = matchingLiveEnvironment();
    live.description = "a different description entirely";
    expect(environmentMatchesConfig(live, buildEnvironmentConfig())).toBe(
      false,
    );
  });

  it("detects switching away from a cloud config", () => {
    const live = matchingLiveEnvironment();
    (
      live as { config: Anthropic.Beta.Environments.BetaEnvironment["config"] }
    ).config = { type: "self_hosted" };
    expect(environmentMatchesConfig(live, buildEnvironmentConfig())).toBe(
      false,
    );
  });

  it("detects networking opening up beyond limited", () => {
    const live = matchingLiveEnvironment();
    if (live.config.type !== "cloud")
      throw new Error("expected a cloud config");
    live.config.networking = { type: "unrestricted" };
    expect(environmentMatchesConfig(live, buildEnvironmentConfig())).toBe(
      false,
    );
  });

  it("detects an allowed host being added", () => {
    const live = matchingLiveEnvironment();
    if (
      live.config.type !== "cloud" ||
      live.config.networking.type !== "limited"
    ) {
      throw new Error("expected limited networking");
    }
    live.config.networking.allowed_hosts = ["example.com"];
    expect(environmentMatchesConfig(live, buildEnvironmentConfig())).toBe(
      false,
    );
  });

  it("detects a package being added", () => {
    const live = matchingLiveEnvironment();
    if (live.config.type !== "cloud")
      throw new Error("expected a cloud config");
    live.config.packages.npm = ["some-package"];
    expect(environmentMatchesConfig(live, buildEnvironmentConfig())).toBe(
      false,
    );
  });

  it("ignores allowed_hosts ordering", () => {
    const config = buildEnvironmentConfig();
    if (
      config.config?.type !== "cloud" ||
      config.config.networking?.type !== "limited"
    ) {
      throw new Error("expected limited networking");
    }
    config.config.networking.allowed_hosts = ["b.example.com", "a.example.com"];

    const live = matchingLiveEnvironment();
    if (
      live.config.type !== "cloud" ||
      live.config.networking.type !== "limited"
    ) {
      throw new Error("expected limited networking");
    }
    live.config.networking.allowed_hosts = ["a.example.com", "b.example.com"];

    expect(environmentMatchesConfig(live, config)).toBe(true);
  });
});
