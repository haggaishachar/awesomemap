import { test } from "node:test";
import assert from "node:assert/strict";
import { projectFilePath, joinDomainProjects } from "../scripts/data-store.mjs";

// projectFilePath/joinDomainProjects are pure; loadAllDomains,
// loadAllProjectEntities, saveDomain, and saveProjectEntity are thin fs
// I/O and not unit tested, same convention as generate.mjs/
// snapshot-history.mjs's main().

test("projectFilePath maps an owner/repo id to its conventional path", () => {
  assert.equal(projectFilePath("postgres/postgres"), "data/projects/postgres/postgres.json");
  assert.equal(projectFilePath("facebook/react"), "data/projects/facebook/react.json");
});

test("projectFilePath throws for an id that isn't a valid owner/repo shorthand", () => {
  assert.throws(() => projectFilePath("not-a-repo-id"), /not a valid "owner\/repo" id/);
});

test("joinDomainProjects merges each membership entry's path onto its project entity", () => {
  const domain = {
    slug: "web-dev",
    projects: [
      { id: "facebook/react", path: ["Frontend Frameworks"] },
      { id: "vuejs/core", path: ["Frontend Frameworks"] },
    ],
  };
  const entitiesById = new Map([
    ["facebook/react", { id: "facebook/react", name: "React", weight: 247895 }],
    ["vuejs/core", { id: "vuejs/core", name: "Vue", weight: 54250 }],
  ]);

  const joined = joinDomainProjects(domain, entitiesById);

  assert.deepEqual(joined, [
    { id: "facebook/react", name: "React", weight: 247895, path: ["Frontend Frameworks"] },
    { id: "vuejs/core", name: "Vue", weight: 54250, path: ["Frontend Frameworks"] },
  ]);
});

test("joinDomainProjects lets the same entity carry a different path per domain", () => {
  const domain = { slug: "automation", projects: [{ id: "n8n-io/n8n", path: ["Workflow Automation"] }] };
  const entitiesById = new Map([["n8n-io/n8n", { id: "n8n-io/n8n", name: "n8n" }]]);

  const joined = joinDomainProjects(domain, entitiesById);

  assert.deepEqual(joined[0].path, ["Workflow Automation"]);
});

test("joinDomainProjects throws on a membership id with no matching entity file", () => {
  const domain = { slug: "web-dev", projects: [{ id: "ghost/repo", path: ["Nowhere"] }] };
  assert.throws(() => joinDomainProjects(domain, new Map()), /"ghost\/repo" has no data\/projects\/ entity file/);
});
