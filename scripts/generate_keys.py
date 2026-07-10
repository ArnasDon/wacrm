# -*- coding: utf-8 -*-
"""
-------------------------------------------------------------------------
NOME..: generate_keys.py
LANG..: Python3
TITULO: Gera todas as chaves/segredos do deploy em .secrets/.env
DATA..: 10/07/2026 02:00
MODIFICADO: 10/07/2026 11:35
VERSÃO: 0.2.0
HOST..: local
LOCAL.: scripts/
OBS...: Gera JWT_SECRET, POSTGRES_PASSWORD, ENCRYPTION_KEY,
        REALTIME_SECRET_KEY_BASE, AUTOMATION_CRON_SECRET,
        EVOLUTION_API_KEY e os JWTs anon/service_role do Supabase
        self-hosted (HS256, derivados do JWT_SECRET). MESCLA com o
        .secrets/.env existente: preserva todas as linhas/variáveis
        atuais e só acrescenta as chaves que faltam. Use --rotate para
        regerar também as já existentes. Sempre cria backup antes.

DEPEND: somente stdlib (secrets, hmac, hashlib, base64, json)

-------------------------------------------------------------------------
Modifications.....:
 Date          Rev    Author           Description
 10/07/2026    1      Claude/yves      Elaboração

-------------------------------------------------------------------------
STATUS: DEV
"""

import logging
import sys
from base64 import urlsafe_b64encode
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from hmac import new as hmac_new
from json import dumps
from pathlib import Path
from secrets import token_hex


def config_logging() -> bool:
    """
    Configura o logging padrão do programa.

    :return: True se configurado (ou já configurado).
    :rtype: bool

    :Example:

    >>> config_logging()
    True
    """
    logger = logging.getLogger()
    if logger.hasHandlers():
        return True
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(funcName)s:%(lineno)d - %(message)s",
        handlers=[logging.StreamHandler()],
    )
    logging.info("=== Programa: %s ===", Path(sys.argv[0]).name)
    return True


def _b64url(data: bytes) -> str:
    """
    Codifica bytes em base64url sem padding (formato JWT).

    :param data: Bytes a codificar.
    :type data: bytes
    :return: String base64url sem '='.
    :rtype: str

    :Example:

    >>> _b64url(b"abc")
    'YWJj'
    """
    return urlsafe_b64encode(data).decode("ascii").rstrip("=")


def gerar_jwt_supabase(role: str, jwt_secret: str) -> str | bool:
    """
    Gera um JWT HS256 no formato esperado pelo Supabase self-hosted.

    :param role: Papel do token ("anon" ou "service_role").
    :type role: str
    :param jwt_secret: Segredo HMAC compartilhado (JWT_SECRET).
    :type jwt_secret: str
    :return: JWT assinado ou False em caso de erro.
    :rtype: str | bool

    :Example:

    >>> token = gerar_jwt_supabase("anon", "x" * 40)
    >>> token.count(".")
    2
    """
    logging.info("=== Função: %s ===", sys._getframe().f_code.co_name)
    if not role or not isinstance(role, str):
        logging.error("Parâmetro 'role' inválido")
        return False
    if not jwt_secret or not isinstance(jwt_secret, str) or len(jwt_secret) < 32:
        logging.error("Parâmetro 'jwt_secret' inválido (mínimo 32 chars)")
        return False
    try:
        agora = datetime.now(timezone.utc)
        header = {"alg": "HS256", "typ": "JWT"}
        payload = {
            "role": role,
            "iss": "supabase",
            "iat": int(agora.timestamp()),
            "exp": int((agora + timedelta(days=3650)).timestamp()),
        }
        parte_header = _b64url(dumps(header, separators=(",", ":")).encode())
        parte_payload = _b64url(dumps(payload, separators=(",", ":")).encode())
        mensagem = f"{parte_header}.{parte_payload}".encode()
        assinatura = hmac_new(jwt_secret.encode(), mensagem, sha256).digest()
        logging.info("=== Termino Função: %s ===", sys._getframe().f_code.co_name)
        return f"{parte_header}.{parte_payload}.{_b64url(assinatura)}"
    except BaseException as errorMsg:
        logging.error("Erro ao gerar JWT")
        logging.error("Exception occurred", exc_info=True)
        logging.error(errorMsg)
        return False


def gerar_chaves() -> dict | bool:
    """
    Gera o conjunto completo de segredos do deploy.

    :return: Dicionário chave->valor ou False em caso de erro.
    :rtype: dict | bool
    """
    logging.info("=== Função: %s ===", sys._getframe().f_code.co_name)
    try:
        jwt_secret = token_hex(32)
        anon = gerar_jwt_supabase("anon", jwt_secret)
        service = gerar_jwt_supabase("service_role", jwt_secret)
        if not anon or not service:
            logging.error("Falha ao derivar JWTs do Supabase")
            return False
        chaves = {
            "JWT_SECRET": jwt_secret,
            "NEXT_PUBLIC_SUPABASE_ANON_KEY": anon,
            "SUPABASE_SERVICE_ROLE_KEY": service,
            "POSTGRES_PASSWORD": token_hex(24),
            "REALTIME_SECRET_KEY_BASE": token_hex(32),
            "ENCRYPTION_KEY": token_hex(32),
            "AUTOMATION_CRON_SECRET": token_hex(32),
            "EVOLUTION_API_KEY": token_hex(32),
        }
        logging.info("=== Termino Função: %s ===", sys._getframe().f_code.co_name)
        return chaves
    except BaseException as errorMsg:
        logging.error("Erro ao gerar chaves")
        logging.error("Exception occurred", exc_info=True)
        logging.error(errorMsg)
        return False


def gravar_env(chaves: dict, destino: Path, rotate: bool = False) -> bool:
    """
    MESCLA as chaves no arquivo dotenv existente, com backup prévio.

    Preserva todas as linhas atuais (comentários, outras variáveis,
    ordem). Variáveis já presentes são mantidas — só são substituídas
    quando ``rotate=True``. Chaves novas são acrescentadas ao final.

    :param chaves: Dicionário chave->valor a mesclar.
    :type chaves: dict
    :param destino: Caminho do arquivo .env de saída.
    :type destino: Path
    :param rotate: Se True, sobrescreve valores de chaves existentes.
    :type rotate: bool
    :return: True em sucesso, False em erro.
    :rtype: bool
    """
    logging.info("=== Função: %s ===", sys._getframe().f_code.co_name)
    if not chaves or not isinstance(chaves, dict):
        logging.error("Parâmetro 'chaves' inválido")
        return False
    if not destino or not isinstance(destino, Path):
        logging.error("Parâmetro 'destino' inválido")
        return False
    try:
        destino.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        agora = datetime.now().strftime("%d/%m/%Y %H:%M")
        linhas: list[str] = []
        existentes: dict[str, int] = {}
        if destino.exists():
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup = destino.with_name(f".env.bak_{stamp}")
            backup.write_text(destino.read_text(encoding="utf-8"), encoding="utf-8")
            backup.chmod(0o600)
            logging.info("Backup criado: %s", backup)
            linhas = destino.read_text(encoding="utf-8").splitlines()
            for indice, linha in enumerate(linhas):
                if "=" in linha and not linha.lstrip().startswith("#"):
                    existentes[linha.split("=", 1)[0].strip()] = indice
        else:
            linhas = [
                f"# Criado em: {agora}",
                "# Gerado por scripts/generate_keys.py — NUNCA versionar.",
            ]
        adicionadas, rotacionadas, preservadas = [], [], []
        for nome, valor in chaves.items():
            if nome in existentes:
                if rotate:
                    linhas[existentes[nome]] = f"{nome}={valor}"
                    rotacionadas.append(nome)
                else:
                    preservadas.append(nome)
            else:
                adicionadas.append(f"{nome}={valor}")
        if adicionadas:
            linhas += ["", f"# Chaves geradas em {agora} (generate_keys.py)"]
            linhas += adicionadas
        # Atualiza (ou insere) o carimbo de modificação no cabeçalho.
        for indice, linha in enumerate(linhas[:5]):
            if linha.startswith("# Modificado em:"):
                linhas[indice] = f"# Modificado em: {agora}"
                break
        else:
            linhas.insert(1, f"# Modificado em: {agora}")
        destino.write_text("\n".join(linhas) + "\n", encoding="utf-8")
        destino.chmod(0o600)
        logging.info(
            "Arquivo gravado: %s (novas: %d, preservadas: %d, rotacionadas: %d)",
            destino, len(adicionadas), len(preservadas), len(rotacionadas),
        )
        logging.info("=== Termino Função: %s ===", sys._getframe().f_code.co_name)
        return True
    except BaseException as errorMsg:
        logging.error("Erro ao gravar o arquivo .env")
        logging.error("Exception occurred", exc_info=True)
        logging.error(errorMsg)
        return False


def main() -> int:
    """
    Ponto de entrada: gera as chaves e mescla em .secrets/.env.

    Uso: python3 scripts/generate_keys.py [--rotate]
    (--rotate regenera também as chaves já existentes no arquivo)

    :return: 0 em sucesso, 1 em erro.
    :rtype: int
    """
    config_logging()
    rotate = "--rotate" in sys.argv[1:]
    raiz = Path(__file__).resolve().parent.parent
    destino = raiz / ".secrets" / ".env"
    chaves = gerar_chaves()
    if not chaves:
        return 1
    if not gravar_env(chaves, destino, rotate):
        return 1
    logging.info("Segredos gerados. Copie/mescle com deploy/.env conforme necessário.")
    logging.info("=== Termino programa: %s ===", Path(sys.argv[0]).name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
