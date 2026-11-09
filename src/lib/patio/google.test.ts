import { describe, it, expect } from "vitest";
import { lerChaveServico } from "./google";

const obj = { type: "service_account", client_email: "x@y.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n" };
const json = JSON.stringify(obj);
const esperado = "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n";

describe("lerChaveServico", () => {
  it("JSON puro", () => expect(lerChaveServico(json)?.private_key).toBe(esperado));
  it("JSON bonito, em várias linhas", () => expect(lerChaveServico(JSON.stringify(obj, null, 2))?.client_email).toBe(obj.client_email));
  it("chave privada com quebras de linha reais", () => {
    const quebrado = json.replace(/\\\\n/g, "\n");
    expect(lerChaveServico(quebrado)?.private_key).toBe(esperado);
  });
  it("entre aspas simples", () => expect(lerChaveServico(`'${json}'`)?.client_email).toBe(obj.client_email));
  it("como texto JSON entre aspas", () => expect(lerChaveServico(JSON.stringify(json))?.client_email).toBe(obj.client_email));
  it("em base64", () => expect(lerChaveServico(Buffer.from(json).toString("base64"))?.client_email).toBe(obj.client_email));
  it("lixo ou vazio", () => {
    expect(lerChaveServico("abc")).toBeNull();
    expect(lerChaveServico("")).toBeNull();
    expect(lerChaveServico('{"a":1}')).toBeNull();
  });
});
