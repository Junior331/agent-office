# Agent Office (nome provisório)

Escritório virtual pra times de agentes do Claude Code: cada projeto é um andar do prédio, o líder e a equipe aparecem no mapa, e você conversa, aprova pedidos, contrata e avalia pela tela ou pelo celular.

## Requisitos

- Node 18+
- Claude Code instalado e logado com a sua conta (`claude login`)

## Instalar (uma vez)

No PowerShell:

```
irm https://raw.githubusercontent.com/Junior331/agent-office/main/install.ps1 | iex
```

O instalador confere o Node e o Claude Code (oferece instalar o que faltar), baixa a última versão, instala em `%LOCALAPPDATA%\AgentOffice\app` e cria o atalho **Escritório de Agentes** na área de trabalho. Rodar de novo atualiza.

Instalação manual (desenvolvimento): `npm install` e `npm run setup` na pasta do código.

O setup instala tudo **no seu usuário**, nada dentro dos projetos:
- `~/.agent-office/kit` — protocolo, templates e hooks
- `~/.claude/agents` e `~/.claude/commands` — agentes do time e os comandos `/team`, `/team-status`, `/team-grant`
- `~/.claude/settings.json` — hooks globais (backup em `settings.json.bak`)

Depois é só usar o Claude Code normalmente: toda pasta onde você abrir uma sessão vira um andar, e o escritório sobe sozinho em http://localhost:4000. Também dá pra adicionar andares pela tela (**＋ Adicionar andar**).

Os dados de cada time ficam em `~/.agent-office/projects/<projeto>/`, fora do repositório.

## Falar com o líder sem terminal

No chat de qualquer andar, fale com o **Líder**. Se não houver uma sessão do Claude Code aberta naquele projeto, o escritório inicia o Claude Code em segundo plano (`claude -p`, sempre continuando a mesma conversa) e a resposta aparece no chat enquanto ele trabalha. **Parar** interrompe.

**Autonomia** (por andar, no chat do líder):
- **Cauteloso**: lê, planeja e escreve nos arquivos do time; pede antes de mexer no código.
- **Equilibrado** (padrão): edita o projeto e roda git de leitura, lint, testes e build; pede antes de instalar pacote, git que altera histórico e comando destrutivo.
- **Livre**: tudo que o Claude Code conseguir. O guard do time continua valendo em todos.

Se o Claude Code estiver instalado num caminho fora do PATH, informe em `~/.agent-office/config.json`: `"claudePath": "C:/caminho/claude.exe"`.

## Outros comandos

```
npm run setup -- status                     o que está instalado e quais andares existem
npm run setup -- migrate "<pasta>"          traz um projeto do kit antigo (.claude/team) pro modelo novo
npm run setup -- uninstall                  remove agentes, comandos e hooks (os dados ficam)
npm run telegram:setup -- <TOKEN_DO_BOT>    liga o Telegram
npm run simulate                            agentes de mentira pra testar a tela
```

## Atualizações

O escritório confere o GitHub a cada 6 horas. Quando sai versão nova, aparece um aviso com **Atualizar agora**: ele baixa, instala e volta sozinho.

Pra publicar uma versão (quem mantém o projeto):

```
git tag v0.3.0 -m "o que mudou"
git push origin v0.3.0
```

O GitHub Actions monta o `agent-office.zip` e o `version.json` e cria a release.

## Telegram

1. No Telegram, fale com **@BotFather** → `/newbot` → copie o token.
2. `npm run telegram:setup -- SEU_TOKEN` e mande `/start` pro bot quando pedir.
3. Reinicie o escritório.
