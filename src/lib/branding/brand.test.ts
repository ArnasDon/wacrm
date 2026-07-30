import { describe, expect, it } from "vitest";

import {
  BRAND_BUCKET,
  DEFAULT_BRAND_TITLE,
  LOGO_MIME,
  MAX_BRAND_NAME_LEN,
  buildBrandMetadata,
  normalizeBrandName,
  parseBrandAssetPath,
  resolveBrand,
} from "./brand";

describe("normalizeBrandName", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeBrandName("  Acme  ")).toBe("Acme");
  });

  // The `accounts_brand_name_len` CHECK rejects the empty string, so an
  // emptied input MUST become NULL rather than "". If this regresses,
  // clearing the brand name fails with a constraint violation instead
  // of reverting to the generic mark.
  it("maps empty and whitespace-only input to null", () => {
    expect(normalizeBrandName("")).toBeNull();
    expect(normalizeBrandName("   ")).toBeNull();
    expect(normalizeBrandName("\n\t ")).toBeNull();
  });

  it("maps null and undefined to null", () => {
    expect(normalizeBrandName(null)).toBeNull();
    expect(normalizeBrandName(undefined)).toBeNull();
  });

  it("caps at the length the column accepts", () => {
    const long = "x".repeat(MAX_BRAND_NAME_LEN + 20);
    expect(normalizeBrandName(long)).toHaveLength(MAX_BRAND_NAME_LEN);
  });

  it("leaves a name at exactly the limit intact", () => {
    const exact = "y".repeat(MAX_BRAND_NAME_LEN);
    expect(normalizeBrandName(exact)).toBe(exact);
  });
});

describe("resolveBrand", () => {
  it("falls back to the generic title when unbranded", () => {
    expect(resolveBrand(null)).toEqual({
      title: DEFAULT_BRAND_TITLE,
      logoUrl: null,
      isCustom: false,
    });
    expect(resolveBrand({ brand_name: null, logo_url: null }).title).toBe(
      DEFAULT_BRAND_TITLE,
    );
  });

  it("uses the caller's fallback when given one", () => {
    // The sidebar passes the translated `Sidebar.title`; the server
    // has no translations and passes the default.
    expect(resolveBrand({}, "Plantilla CRM para WhatsApp").title).toBe(
      "Plantilla CRM para WhatsApp",
    );
  });

  it("returns the configured name and logo", () => {
    const brand = resolveBrand({
      brand_name: "Acme",
      logo_url: "https://x.supabase.co/storage/v1/object/public/brand-assets/a/b.png",
    });
    expect(brand.title).toBe("Acme");
    expect(brand.logoUrl).toContain("b.png");
    expect(brand.isCustom).toBe(true);
  });

  it("treats an empty logo_url as no logo", () => {
    expect(resolveBrand({ brand_name: "Acme", logo_url: "" }).logoUrl).toBeNull();
  });

  it("reports isCustom false when only a logo is set", () => {
    const brand = resolveBrand({ brand_name: null, logo_url: "https://x/y.png" });
    expect(brand.isCustom).toBe(false);
    expect(brand.logoUrl).toBe("https://x/y.png");
  });
});

describe("parseBrandAssetPath", () => {
  const base = "https://proj.supabase.co/storage/v1/object/public/brand-assets/";

  it("extracts the account-scoped object path", () => {
    expect(parseBrandAssetPath(`${base}account-abc/1700-logo.png`)).toBe(
      "account-abc/1700-logo.png",
    );
  });

  it("drops a query string and a fragment", () => {
    expect(parseBrandAssetPath(`${base}account-abc/logo.png?v=2`)).toBe(
      "account-abc/logo.png",
    );
    expect(parseBrandAssetPath(`${base}account-abc/logo.png#x`)).toBe(
      "account-abc/logo.png",
    );
  });

  it("decodes percent-encoding back to the raw object path", () => {
    expect(parseBrandAssetPath(`${base}account-abc/my%20logo.png`)).toBe(
      "account-abc/my logo.png",
    );
  });

  // Refusing to guess is the point: a null means "skip the delete",
  // which is far better than deriving a wrong path and removing
  // somebody else's object.
  it("returns null for another bucket or another host", () => {
    expect(
      parseBrandAssetPath(
        "https://proj.supabase.co/storage/v1/object/public/chat-media/account-abc/x.png",
      ),
    ).toBeNull();
    expect(parseBrandAssetPath("https://cdn.example.com/logo.png")).toBeNull();
  });

  it("returns null for empty, missing and malformed input", () => {
    expect(parseBrandAssetPath(null)).toBeNull();
    expect(parseBrandAssetPath(undefined)).toBeNull();
    expect(parseBrandAssetPath("")).toBeNull();
    expect(parseBrandAssetPath(base)).toBeNull();
    expect(parseBrandAssetPath(`${base}bad%zz`)).toBeNull();
  });
});

describe("buildBrandMetadata", () => {
  // Pins the fix for a real Next behaviour: `title.default` is resolved
  // THROUGH the parent template, so with the root layout's
  // `template: "%s — wacrm"` a branded account would show
  // "Acme — wacrm" in the tab. Only `absolute` bypasses it.
  it("uses title.absolute, never title.default", () => {
    const meta = buildBrandMetadata(resolveBrand({ brand_name: "Acme" }));
    expect(meta.title.absolute).toBe("Acme");
    expect(meta.title).not.toHaveProperty("default");
  });

  it("keeps a template so page titles stay branded", () => {
    const meta = buildBrandMetadata(resolveBrand({ brand_name: "Acme" }));
    expect(meta.title.template).toBe("%s — Acme");
  });

  it("points the icon at the uploaded logo when there is one", () => {
    const meta = buildBrandMetadata(
      resolveBrand({ brand_name: "Acme", logo_url: "https://x/logo.png" }),
    );
    expect(meta.icons.icon).toEqual([{ url: "https://x/logo.png" }]);
  });

  it("falls back to the generated default mark", () => {
    const meta = buildBrandMetadata(resolveBrand(null));
    expect(meta.icons.icon).toEqual([{ url: "/icon" }]);
    expect(meta.title.absolute).toBe(DEFAULT_BRAND_TITLE);
  });
});

describe("constants", () => {
  it("keeps the MIME allow-list free of SVG", () => {
    // A public bucket serving image/svg+xml renders as a document at
    // its own URL and can execute script in the Storage origin.
    expect(LOGO_MIME).not.toContain("image/svg+xml");
  });

  it("names the bucket created by migration 043", () => {
    expect(BRAND_BUCKET).toBe("brand-assets");
  });
});
