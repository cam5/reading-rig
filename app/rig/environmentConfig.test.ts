import { describe, expect, it } from "vitest";
import { buildEnvironmentConfig, ENVIRONMENT_NAME } from "./environmentConfig";

describe("buildEnvironmentConfig", () => {
  it("names the environment", () => {
    expect(buildEnvironmentConfig().name).toBe(ENVIRONMENT_NAME);
  });

  it("is a cloud environment", () => {
    expect(buildEnvironmentConfig().config).toMatchObject({ type: "cloud" });
  });

  it("locks networking down to no hosts, no mcp servers, no package managers", () => {
    const config = buildEnvironmentConfig().config;
    if (!config || config.type !== "cloud") throw new Error("expected a cloud config");

    expect(config.networking).toMatchObject({
      type: "limited",
      allow_mcp_servers: false,
      allow_package_managers: false,
      allowed_hosts: [],
    });
  });

  it("installs no packages", () => {
    const config = buildEnvironmentConfig().config;
    if (!config || config.type !== "cloud") throw new Error("expected a cloud config");

    expect(config.packages).toEqual({ apt: [], cargo: [], gem: [], go: [], npm: [], pip: [] });
  });
});
