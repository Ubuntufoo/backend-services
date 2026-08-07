import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, symlink } from "fs/promises";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFuturePlan,
  digest,
  generateRunIdentity,
  executableYouPickManifestSchema,
  type YouPickPilotReadApi,
  type RuntimeSnapshot,
} from "@/ebay/you-pick-sandbox-pilot.js";
import type { CliSeams } from "@/scripts/verify-you-pick-sandbox.js";

const tempRoots: string[] = [];
const fixedDate = new Date("2026-08-06T19:03:00.000Z");

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.restoreAllMocks();
});

const defaultRuntime: RuntimeSnapshot = {
  environment: "sandbox", restOrigin: "https://api.sandbox.ebay.com", oauthOrigin: "https://api.sandbox.ebay.com", tradingOrigin: "https://api.sandbox.ebay.com",
  marketplaceId: "EBAY_US", contentLanguage: "en-US", hasUserRefreshToken: true, productionCredentialMaterialPresent: false,
  background: { jobRunner: false, apify: false, soldComps: false, publishing: false, watcher: false },
  forbiddenDependencies: { supabase: false, r2: false, jobs: false, watcher: false, ai: false, pricing: false },
};

function validManifestJson(): string {
  const run = generateRunIdentity(2, fixedDate, Buffer.from("a1b2c3", "hex"));
  const fixture = {
    version: 2 as const, marketplaceId: "EBAY_US" as const, categoryId: "261328" as const, format: "FIXED_PRICE" as const, contentLanguage: "en-US" as const,
    policies: { fulfillmentPolicyId: "FP-1", paymentPolicyId: "PP-1", returnPolicyId: "RP-1" },
    merchantLocationKey: "MLK-1",
    selector: { name: "Card" as const, values: ["a", "b"] },
    group: { title: "T", description: "D", sharedAspects: { Brand: ["P"] }, variantSkuSnapshot: ["C01", "C02"], variesBy: { specifications: [{ name: "Card", values: ["a", "b"] }], aspectsImageVariesBy: "Card" } },
    sharedCondition: { condition: "USED_VERY_GOOD" as const, conditionId: "4000" as const, conditionDescriptors: [{ name: "40001", values: ["400012"] }] },
    children: [
      { slot: "C01" as const, selector: { name: "Card", value: "a" }, productAspects: { Card: ["a"], Brand: ["P"] }, itemQuantity: 1, offerQuantity: 1, price: { currency: "USD" as const, value: "10.00" }, images: [{ role: "front" as const, url: "https://example.com/1.jpg", fingerprint: "fp1" }, { role: "back" as const, url: "https://example.com/2.jpg", fingerprint: "fp2" }], condition: { condition: "USED_VERY_GOOD" as const, conditionId: "4000" as const, conditionDescriptors: [{ name: "40001", values: ["400012"] }] } },
      { slot: "C02" as const, selector: { name: "Card", value: "b" }, productAspects: { Card: ["b"], Brand: ["P"] }, itemQuantity: 2, offerQuantity: 2, price: { currency: "USD" as const, value: "20.00" }, images: [{ role: "front" as const, url: "https://example.com/3.jpg", fingerprint: "fp3" }, { role: "back" as const, url: "https://example.com/4.jpg", fingerprint: "fp4" }], condition: { condition: "USED_VERY_GOOD" as const, conditionId: "4000" as const, conditionDescriptors: [{ name: "40001", values: ["400012"] }] } },
    ],
  };
  const plan = buildFuturePlan(fixture, run);
  const completedOps = new Set(["item-C01", "item-C02", "offer-C01", "offer-C02", "group-complete", "publish-group"]);
  const manifest = executableYouPickManifestSchema.parse({
    version: 5, run,
    createdAt: fixedDate.toISOString(), updatedAt: fixedDate.toISOString(), mode: "dry-run",
    checkpoint: "awaiting-published-view-verification", seller: { userId: "testuser" },
    expected: { environment: "sandbox", restOrigin: "https://api.sandbox.ebay.com", oauthOrigin: "https://api.sandbox.ebay.com", tradingOrigin: "https://api.sandbox.ebay.com", marketplaceId: "EBAY_US", categoryId: "261328", contentLanguage: "en-US" },
    ownership: {
      selectorName: fixture.selector.name, selectorValues: fixture.selector.values,
      imageFingerprints: fixture.children.flatMap((c) => c.images.map((i) => i.fingerprint)),
      itemQuantities: fixture.children.map((c) => c.itemQuantity),
      offerQuantities: fixture.children.map((c) => c.offerQuantity),
      prices: fixture.children.map((c) => c.price.value),
      condition: fixture.sharedCondition.condition, conditionId: fixture.sharedCondition.conditionId,
      conditionDescriptors: fixture.sharedCondition.conditionDescriptors, conditionDigest: digest(fixture.sharedCondition),
      fulfillmentPolicyId: fixture.policies.fulfillmentPolicyId, paymentPolicyId: fixture.policies.paymentPolicyId,
      returnPolicyId: fixture.policies.returnPolicyId, merchantLocationKey: fixture.merchantLocationKey,
    },
    arrangementId: plan.arrangementId, predecessorRunId: null, predecessorFullyCleaned: false,
    published: true, groupListingId: "LISTING-1",
    resources: run.childSkus.map((sku, i) => ({ sku, offerId: i === 0 ? "OFFER-1" : "OFFER-2", offerStatus: "PUBLISHED" })),
    gates: [], collisions: [], metadataSummary: null, cleanupRemoteSummary: null,
    operations: plan.operations.map(({ id, kind, digest: value }) => ({ id, kind, digest: value })),
    execution: {
      eligible: true, fixture,
      ledger: plan.operations.map(({ id, kind, digest: requestDigest }) => ({
        id, kind, requestDigest,
        state: completedOps.has(id) ? ("completed" as const) : ("planned" as const),
        attemptCount: completedOps.has(id) ? 1 : 0,
        startedAt: completedOps.has(id) ? fixedDate.toISOString() : null,
        completedAt: completedOps.has(id) ? fixedDate.toISOString() : null,
        result: null, error: null,
        readBackDigest: completedOps.has(id) ? "a".repeat(64) : null,
      })),
      publishedAttestationDigest: null, quantityZeroAttestationDigest: null,
    },
    cleanup: { attempts: 0, finalAbsenceVerified: false }, lastError: null,
  });
  return JSON.stringify(manifest);
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

describe("parseVerifyArgs", () => {
  let parseVerifyArgs: typeof import("@/scripts/verify-you-pick-sandbox.js").parseVerifyArgs;

  beforeAll(async () => {
    parseVerifyArgs = (await import("@/scripts/verify-you-pick-sandbox.js")).parseVerifyArgs;
  });

  it("parses valid relative manifest path and seller", () => {
    const args = parseVerifyArgs(["--manifest", ".local/you-pick-sandbox/my-run/manifest.json", "--confirm-sandbox-seller", "testuser"]);
    expect(args.manifestPath).toBe(".local/you-pick-sandbox/my-run/manifest.json");
    expect(args.confirmSandboxSeller).toBe("testuser");
  });

  it("throws on absolute path", () => {
    expect(() => parseVerifyArgs(["--manifest", "/abs/path/manifest.json", "--confirm-sandbox-seller", "x"])).toThrow("Absolute paths are forbidden");
  });

  it("throws on traversal", () => {
    expect(() => parseVerifyArgs(["--manifest", ".local/you-pick-sandbox/../other/manifest.json", "--confirm-sandbox-seller", "x"])).toThrow("traversal");
  });

  it("throws on path outside guarded prefix", () => {
    expect(() => parseVerifyArgs(["--manifest", "other-dir/manifest.json", "--confirm-sandbox-seller", "x"])).toThrow(".local/you-pick-sandbox/");
  });

  it("throws on wrong filename not ending in /manifest.json", () => {
    expect(() => parseVerifyArgs(["--manifest", ".local/you-pick-sandbox/run/wrong.json", "--confirm-sandbox-seller", "x"])).toThrow("/manifest.json");
  });

  it("throws on backslash in path", () => {
    expect(() => parseVerifyArgs(["--manifest", ".local\\you-pick-sandbox\\run\\manifest.json", "--confirm-sandbox-seller", "x"])).toThrow("Backslashes are forbidden");
  });

  it("throws on duplicate --manifest", () => {
    expect(() => parseVerifyArgs(["--manifest", ".local/you-pick-sandbox/a/manifest.json", "--manifest", ".local/you-pick-sandbox/b/manifest.json", "--confirm-sandbox-seller", "x"])).toThrow("may be supplied only once");
  });

  it("throws on --fixture flag", () => {
    expect(() => parseVerifyArgs(["--fixture", "f.json", "--manifest", ".local/you-pick-sandbox/a/manifest.json", "--confirm-sandbox-seller", "x"])).toThrow("Forbidden mutation flag: --fixture");
  });

  it("throws on --execute flag", () => {
    expect(() => parseVerifyArgs(["--manifest", ".local/you-pick-sandbox/a/manifest.json", "--confirm-sandbox-seller", "x", "--execute"])).toThrow("Forbidden mutation flag: --execute");
  });

  it("throws on --cleanup flag", () => {
    expect(() => parseVerifyArgs(["--manifest", ".local/you-pick-sandbox/a/manifest.json", "--confirm-sandbox-seller", "x", "--cleanup"])).toThrow("Forbidden mutation flag: --cleanup");
  });

  it("throws on --attestation flag", () => {
    expect(() => parseVerifyArgs(["--manifest", ".local/you-pick-sandbox/a/manifest.json", "--attestation", "a.json", "--confirm-sandbox-seller", "x"])).toThrow("Forbidden mutation flag: --attestation");
  });

  it("throws on unknown flag", () => {
    expect(() => parseVerifyArgs(["--manifest", ".local/you-pick-sandbox/a/manifest.json", "--confirm-sandbox-seller", "x", "--unknown"])).toThrow("Unknown argument");
  });

  it("throws when --manifest value is empty", () => {
    expect(() => parseVerifyArgs(["--manifest", "", "--confirm-sandbox-seller", "x"])).toThrow("requires a non-empty value");
  });
});

describe("runVerifyYouPickSandboxCli DI", () => {
  let runVerifyYouPickSandboxCli: typeof import("@/scripts/verify-you-pick-sandbox.js").runVerifyYouPickSandboxCli;

  beforeAll(async () => {
    runVerifyYouPickSandboxCli = (await import("@/scripts/verify-you-pick-sandbox.js")).runVerifyYouPickSandboxCli;
  });

  it("read API resolved, runtime gate fails, nothing printed", async () => {
    const root = await mkdtemp(join(tmpdir(), "vp-"));
    tempRoots.push(root);
    const localDir = join(root, ".local", "you-pick-sandbox", "20260806T190300Z-a1b2c3");
    await mkdir(localDir, { recursive: true });
    const manifestContent = validManifestJson();
    await writeFile(join(localDir, "manifest.json"), manifestContent, "utf8");
    const printed: string[] = [];
    const apiFactory = vi.fn(async () => ({
      getRuntimeSnapshot: vi.fn(async () => { throw new Error("bypass runtime gate"); }),
      getCurrentUserIdentity: vi.fn(), getPolicyLocationSnapshot: vi.fn(), getMetadataSnapshot: vi.fn(),
      getInventoryItemGroup: vi.fn(), getInventoryItem: vi.fn(), getOffers: vi.fn(),
    }));
    await expect(runVerifyYouPickSandboxCli(
      ["--manifest", ".local/you-pick-sandbox/20260806T190300Z-a1b2c3/manifest.json", "--confirm-sandbox-seller", "testuser"],
      { repoRoot: root, readApiFactory: apiFactory, print: (o: string) => { printed.push(o); }, sha256FileImpl: async () => "e".repeat(64), readFileImpl: async () => manifestContent }
    )).rejects.toThrow("bypass runtime gate");
    expect(apiFactory).toHaveBeenCalledTimes(1);
    expect(printed).toHaveLength(0);
  });

  it("corrupt manifest — read API never resolved", async () => {
    const root = await mkdtemp(join(tmpdir(), "vp-"));
    tempRoots.push(root);
    const localDir = join(root, ".local", "you-pick-sandbox", "20260806T190300Z-deadbe");
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "manifest.json"), "not json", "utf8");
    let factoryCalled = false;
    await expect(runVerifyYouPickSandboxCli(
      ["--manifest", ".local/you-pick-sandbox/20260806T190300Z-deadbe/manifest.json", "--confirm-sandbox-seller", "testuser"],
      { repoRoot: root, readApiFactory: async () => { factoryCalled = true; throw new Error("never"); }, readFileImpl: async () => "not json", sha256FileImpl: async () => "e".repeat(64) }
    )).rejects.toThrow("Manifest is missing or corrupt");
    expect(factoryCalled).toBe(false);
  });

  it("successful CLI run returns verified JSON to print", async () => {
    const root = await mkdtemp(join(tmpdir(), "vp-"));
    tempRoots.push(root);
    const localDir = join(root, ".local", "you-pick-sandbox", "20260806T190300Z-a1b2c3");
    await mkdir(localDir, { recursive: true });
    const manifestContent = validManifestJson();
    const manifestFile = join(localDir, "manifest.json");
    await writeFile(manifestFile, manifestContent, "utf8");

    const manifest = JSON.parse(manifestContent);
    const plan = buildFuturePlan(manifest.execution.fixture, manifest.run);
    const groupPayload = plan.operations.find((o: any) => o.id === "group-complete")!.payload;

    const preBytes = await readFile(manifestFile);
    const preHash = createHash("sha256").update(preBytes).digest("hex");
    const preDirEntries = new Set(await readdir(localDir));

    const printed: string[] = [];
    const apiFactoryCalled = vi.fn();

    await runVerifyYouPickSandboxCli(
      ["--manifest", ".local/you-pick-sandbox/20260806T190300Z-a1b2c3/manifest.json", "--confirm-sandbox-seller", "testuser"],
      {
        repoRoot: root,
        readApiFactory: async () => {
          apiFactoryCalled();
          const { projectInventoryItemSemanticSnapshot, projectOfferSemanticSnapshot } = await import("@/ebay/you-pick-sandbox-pilot.js");
          return {
            getRuntimeSnapshot: vi.fn(async () => ({ ...defaultRuntime })),
            getCurrentUserIdentity: vi.fn(async () => ({ userId: "testuser", username: "testuser" })),
            getPolicyLocationSnapshot: vi.fn(),
            getMetadataSnapshot: vi.fn(),
            getInventoryItem: vi.fn(async (sku: string) => {
              const idx = manifest.run.childSkus.indexOf(sku);
              const slot = `C0${idx + 1}`;
              const itemPayload = plan.operations.find((o: any) => o.id === `item-${slot}`)!.payload;
              return { status: "found", value: { sku, groupKeys: [manifest.run.groupKey], quantity: manifest.ownership.itemQuantities[idx], semanticSnapshot: projectInventoryItemSemanticSnapshot(itemPayload) } };
            }),
            getOffers: vi.fn(async (sku: string) => {
              const idx = manifest.run.childSkus.indexOf(sku);
              const slot = `C0${idx + 1}`;
              const qty = manifest.ownership.offerQuantities[idx];
              const offerPayload = plan.operations.find((o: any) => o.id === `offer-${slot}`)!.payload;
              return { status: "found", value: { offers: [{ offerId: manifest.resources[idx].offerId, sku, marketplaceId: "EBAY_US", status: "PUBLISHED", listingId: "LISTING-1", listingStatus: "ACTIVE", lifecycleClass: "active" as any, publicationObserved: true, listingCurrentlyActive: true, withdrawRequired: true, availableQuantity: qty, semanticSnapshot: projectOfferSemanticSnapshot(offerPayload) }] } };
            }),
            getInventoryItemGroup: vi.fn(async () => ({ status: "found", value: { variantSKUs: [...manifest.run.childSkus], snapshotDigest: digest(groupPayload) } })),
          };
        },
        sha256FileImpl: async () => preHash,
        readFileImpl: async () => manifestContent,
        print: (o: string) => { printed.push(o); },
      }
    );

    expect(apiFactoryCalled).toHaveBeenCalledTimes(1);
    expect(printed).toHaveLength(1);

    const report = JSON.parse(printed[0]);
    expect(report.status).toBe("verified");
    expect(report.listingId).toBe("LISTING-1");
    expect(report.children).toHaveLength(2);
    expect(report.children[0].itemSemanticMatch).toBe(true);
    expect(report.children[1].itemSemanticMatch).toBe(true);
    expect(report.reads.identity).toBe(1);
    expect(report.reads.inventoryItems).toBe(2);
    expect(report.reads.offers).toBe(2);
    expect(report.reads.group).toBe(1);
    expect(report.mutationCapabilitiesResolved).toBe(false);
    expect(report.manifestWritten).toBe(false);

    // Byte preservation
    const postBytes = await readFile(manifestFile);
    const postHash = createHash("sha256").update(postBytes).digest("hex");
    expect(postHash).toBe(preHash);

    // Directory preservation
    const postDirEntries = new Set(await readdir(localDir));
    expect(postDirEntries).toEqual(preDirEntries);
  });

  it("throws on symlink escape via realpath", async () => {
    const root = await mkdtemp(join(tmpdir(), "vp-"));
    tempRoots.push(root);
    const outsideDir = await mkdtemp(join(tmpdir(), "outside-"));
    const localDir = join(root, ".local", "you-pick-sandbox", "20260806T190300Z-a1b2c3");
    await mkdir(localDir, { recursive: true });
    await writeFile(join(localDir, "manifest.json"), validManifestJson(), "utf8");
    const symlinkPath = join(root, ".local", "you-pick-sandbox", "20260806T190300Z-escape");
    await symlink(outsideDir, symlinkPath, "dir");
    await mkdir(join(symlinkPath, "sub"), { recursive: true });
    await writeFile(join(symlinkPath, "sub", "manifest.json"), validManifestJson(), "utf8");
    await expect(runVerifyYouPickSandboxCli(
      ["--manifest", ".local/you-pick-sandbox/20260806T190300Z-escape/sub/manifest.json", "--confirm-sandbox-seller", "testuser"],
      { repoRoot: root, readFileImpl: async () => validManifestJson(), sha256FileImpl: async () => "e".repeat(64) }
    )).rejects.toThrow("Manifest real path must reside within .local/you-pick-sandbox/");
  });

  it("byte-preservation: manifest unchanged after verification failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "vp-"));
    tempRoots.push(root);
    const localDir = join(root, ".local", "you-pick-sandbox", "20260806T190300Z-a1b2c3");
    await mkdir(localDir, { recursive: true });
    const manifestContent = validManifestJson();
    const manifestFile = join(localDir, "manifest.json");
    await writeFile(manifestFile, manifestContent, "utf8");
    const preHash = sha256(manifestContent);
    const preDirEntries = new Set(await readdir(localDir));

    await expect(runVerifyYouPickSandboxCli(
      ["--manifest", ".local/you-pick-sandbox/20260806T190300Z-a1b2c3/manifest.json", "--confirm-sandbox-seller", "testuser"],
      {
        repoRoot: root,
        readApiFactory: async () => ({
          getRuntimeSnapshot: vi.fn(async () => ({ ...defaultRuntime })),
          getCurrentUserIdentity: vi.fn(async () => ({ userId: "testuser", username: "testuser" })),
          getPolicyLocationSnapshot: vi.fn(), getMetadataSnapshot: vi.fn(),
          getInventoryItemGroup: vi.fn(async () => ({ status: "unknown" as const, reason: "error" })),
          getInventoryItem: vi.fn(async () => ({ status: "found" as const, value: { sku: "x", groupKeys: ["G"], quantity: 1, semanticSnapshot: undefined } })),
          getOffers: vi.fn(async () => ({ status: "found" as const, value: { offers: [] } })),
        }),
        sha256FileImpl: async () => preHash,
        readFileImpl: async () => manifestContent,
      }
    )).rejects.toThrow();

    const postBytes = await readFile(manifestFile);
    const postHash = sha256(postBytes.toString("utf8"));
    expect(postHash).toBe(preHash);

    // Directory preservation after failure
    const postDirEntries = new Set(await readdir(localDir));
    expect(postDirEntries).toEqual(preDirEntries);
  });
});
