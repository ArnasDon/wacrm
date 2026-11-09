import { describe, it, expect } from "vitest";
import { casarVisitas } from "./ga4";

describe("casarVisitas", () => {
  it("acha o carro pelo caminho, com ou sem barra e domínio", () => {
    const r = casarVisitas({ "/carros/byd-song-plus/": 40, "/carros/byd-song-plus": 2, "/": 300, "/carros/nivus": 9 }, { a: "/carros/byd-song-plus/", b: "https://iboxprime.com.br/carros/nivus/", c: "/carros/z4/" });
    expect(r.total).toBe(351);
    expect(r.porCarro).toEqual({ a: 42, b: 9 });
  });
});
