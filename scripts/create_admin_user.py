# -*- coding: utf-8 -*-
"""
-------------------------------------------------------------------------
NOME..: create_admin_user.py
LANG..: Python3
TITULO: Cria usuário pré-definido via Admin API do GoTrue (Supabase)
DATA..: 10/07/2026 12:00
MODIFICADO: 10/07/2026 12:00
VERSÃO: 0.1.0
HOST..: local / diversos
LOCAL.: scripts/
OBS...: Lê credenciais do usuário de .secrets/create_account.json
        (email, password, username ou full_name) e as chaves de API de
        .secrets/.env (NEXT_PUBLIC_SUPABASE_URL e
        SUPABASE_SERVICE_ROLE_KEY). Nada é hardcoded. Funciona mesmo
        com GOTRUE_DISABLE_SIGNUP=true (a Admin API ignora o bloqueio
        de signup público). O trigger handle_new_user do banco cria o
        profile/conta automaticamente.

DEPEND: requests

-------------------------------------------------------------------------
Modifications.....:
 Date          Rev    Author           Description
 10/07/2026    1      Claude/yves      Elaboração

-------------------------------------------------------------------------
STATUS: DEV
"""

import logging
import sys
from json import loads
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parent.parent
SECRETS_DIR = RAIZ / ".secrets"


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


def _mask(valor: str) -> str:
    """
    Mascara um valor sensível para log (mostra só o tamanho).

    :param valor: Valor a mascarar.
    :type valor: str
    :return: Máscara no formato ``********(N)``.
    :rtype: str

    :Example:

    >>> _mask("segredo")
    '********(7)'
    """
    return f"********({len(valor)})" if isinstance(valor, str) else "********"


def carregar_env(caminho: Path) -> dict | bool:
    """
    Carrega variáveis de um arquivo dotenv simples (chave=valor).

    :param caminho: Caminho do arquivo .env.
    :type caminho: Path
    :return: Dicionário de variáveis ou False em caso de erro.
    :rtype: dict | bool
    """
    logging.info("=== Função: %s ===", sys._getframe().f_code.co_name)
    if not caminho or not isinstance(caminho, Path):
        logging.error("Parâmetro 'caminho' inválido")
        return False
    try:
        if not caminho.exists():
            logging.error("Arquivo não encontrado: %s", caminho)
            return False
        variaveis: dict[str, str] = {}
        for linha in caminho.read_text(encoding="utf-8").splitlines():
            linha = linha.strip()
            if not linha or linha.startswith("#") or "=" not in linha:
                continue
            nome, valor = linha.split("=", 1)
            variaveis[nome.strip()] = valor.strip().strip('"').strip("'")
        logging.info("Variáveis carregadas: %d", len(variaveis))
        logging.info("=== Termino Função: %s ===", sys._getframe().f_code.co_name)
        return variaveis
    except BaseException as errorMsg:
        logging.error("Erro ao carregar o arquivo .env")
        logging.error("Exception occurred", exc_info=True)
        logging.error(errorMsg)
        return False


def carregar_conta(caminho: Path) -> dict | bool:
    """
    Carrega e valida as credenciais do usuário a criar.

    Aceita ``full_name`` ou, na falta dele, mapeia ``username`` para o
    nome de exibição (usado pelo trigger handle_new_user do banco).

    :param caminho: Caminho do JSON (ex.: .secrets/create_account.json).
    :type caminho: Path
    :return: Dict com email, password e full_name, ou False em erro.
    :rtype: dict | bool
    """
    logging.info("=== Função: %s ===", sys._getframe().f_code.co_name)
    if not caminho or not isinstance(caminho, Path):
        logging.error("Parâmetro 'caminho' inválido")
        return False
    try:
        if not caminho.exists():
            logging.error("Arquivo não encontrado: %s", caminho)
            return False
        dados = loads(caminho.read_text(encoding="utf-8"))
        email = dados.get("email", "")
        password = dados.get("password", "")
        full_name = dados.get("full_name") or dados.get("username") or ""
        if not email or "@" not in email:
            logging.error("Campo 'email' ausente ou inválido no JSON")
            return False
        if not password or len(password) < 8:
            logging.error("Campo 'password' ausente ou menor que 8 caracteres")
            return False
        if not full_name:
            logging.warning("Sem 'full_name'/'username' — perfil ficará sem nome")
        logging.info(
            "Conta carregada: email=%s, password=%s, full_name=%s",
            email, _mask(password), full_name,
        )
        logging.info("=== Termino Função: %s ===", sys._getframe().f_code.co_name)
        return {"email": email, "password": password, "full_name": full_name}
    except BaseException as errorMsg:
        logging.error("Erro ao carregar o JSON de conta")
        logging.error("Exception occurred", exc_info=True)
        logging.error(errorMsg)
        return False


def criar_usuario(send_data: dict) -> dict | bool:
    """
    Cria o usuário via Admin API do GoTrue (POST /auth/v1/admin/users).

    :param send_data: Dict com supabase_url, service_role_key, email,
        password e full_name.
    :type send_data: dict
    :return: JSON do usuário criado ou False em caso de erro.
    :rtype: dict | bool
    """
    logging.info("=== Função: %s ===", sys._getframe().f_code.co_name)
    if not send_data or not isinstance(send_data, dict):
        logging.error("Parâmetro 'send_data' inválido")
        return False
    for campo in ("supabase_url", "service_role_key", "email", "password"):
        if not send_data.get(campo):
            logging.error("Campo obrigatório ausente em send_data: %s", campo)
            return False
    try:
        endpoint = f"{send_data['supabase_url'].rstrip('/')}/auth/v1/admin/users"
        headers = {
            "Authorization": f"Bearer {send_data['service_role_key']}",
            "apikey": send_data["service_role_key"],
            "Content-Type": "application/json",
        }
        payload = {
            "email": send_data["email"],
            "password": send_data["password"],
            "email_confirm": True,
            "user_metadata": {"full_name": send_data.get("full_name", "")},
        }
        resposta = requests.post(endpoint, headers=headers, json=payload, timeout=30)
        if resposta.status_code in (200, 201):
            corpo = resposta.json()
            logging.info("Usuário criado: id=%s, email=%s", corpo.get("id"), send_data["email"])
            logging.info("=== Termino Função: %s ===", sys._getframe().f_code.co_name)
            return corpo
        if resposta.status_code == 422 and "already" in resposta.text.lower():
            logging.warning("Usuário já existe: %s — nada a fazer", send_data["email"])
            return {"status": "exists", "email": send_data["email"]}
        logging.error("Falha na criação: HTTP %d", resposta.status_code)
        logging.error("Resposta: %s", resposta.text[:500])
        return False
    except BaseException as errorMsg:
        logging.error("Erro na chamada à Admin API do GoTrue")
        logging.error("Exception occurred", exc_info=True)
        logging.error(errorMsg)
        return False


def main() -> int:
    """
    Ponto de entrada: carrega segredos e cria o usuário.

    :return: 0 em sucesso, 1 em erro.
    :rtype: int
    """
    config_logging()
    env = carregar_env(SECRETS_DIR / ".env")
    if not env:
        return 1
    conta = carregar_conta(SECRETS_DIR / "create_account.json")
    if not conta:
        return 1
    supabase_url = env.get("NEXT_PUBLIC_SUPABASE_URL", "")
    service_role_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not supabase_url or not supabase_url.startswith("http"):
        logging.error("NEXT_PUBLIC_SUPABASE_URL ausente/inválida no .secrets/.env")
        return 1
    if not service_role_key:
        logging.error("SUPABASE_SERVICE_ROLE_KEY ausente no .secrets/.env")
        return 1
    logging.info(
        "==> VAR: supabase_url TYPE: %s, CONTENT: %s", type(supabase_url), supabase_url
    )
    logging.info(
        "==> VAR: service_role_key TYPE: %s, CONTENT: %s",
        type(service_role_key), _mask(service_role_key),
    )
    send_data = {
        "supabase_url": supabase_url,
        "service_role_key": service_role_key,
        "email": conta["email"],
        "password": conta["password"],
        "full_name": conta["full_name"],
    }
    resultado = criar_usuario(send_data)
    if not resultado:
        return 1
    logging.info("Concluído com sucesso.")
    logging.info("=== Termino programa: %s ===", Path(sys.argv[0]).name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
