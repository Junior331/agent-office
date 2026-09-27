# 🏢 Escritório de Agentes

Um escritório virtual pro **Claude Code**. Cada projeto seu vira um andar de um prédio. Em cada andar tem um **Líder**, que monta e coordena uma equipe de agentes (Front, QA, Designer, Back), e você acompanha tudo num mapa: quem está trabalhando, no quê, o que precisa de você.

Pela tela você conversa com o líder e com cada agente, aprova pedidos, contrata e desliga agentes e vê o desempenho da equipe. Não precisa abrir terminal.

> Tudo roda **no seu computador**, com **a sua conta** do Claude. O escritório não tem servidor próprio e não recebe o seu código.

---

## ✅ Antes de começar

| Precisa ter | Por quê | Como conseguir |
|---|---|---|
| **Windows 10 ou 11** | É onde o instalador e a atualização automática funcionam | — |
| **Conta do Claude** (Pro, Max ou Team) ou chave de API da Anthropic | Os agentes usam a sua conta | [claude.ai](https://claude.ai) |
| **Node.js 18 ou mais novo** | O escritório roda em Node | O instalador oferece instalar pra você |
| **Claude Code** | É ele que faz o trabalho | O instalador oferece instalar pra você |
| **Git para Windows** | O Claude Code no Windows precisa dele | [git-scm.com/download/win](https://git-scm.com/download/win) |

### Sistemas operacionais

| Sistema | Situação |
|---|---|
| **Windows 11** | ✅ Suportado e testado |
| **Windows 10** | ✅ Suportado |
| **macOS** | ⚠️ Experimental: instalação manual (veja [Instalação manual](#instalação-manual-macos-linux-ou-desenvolvimento)), sem atalho nem atualização automática |
| **Linux** | ⚠️ Experimental: igual ao macOS |

---

## 🚀 Instalação (Windows), passo a passo

### 1. Instale o Git para Windows

Se ainda não tem, baixe em [git-scm.com/download/win](https://git-scm.com/download/win) e instale com as opções padrão (é só ir clicando em **Next**).

### 2. Abra o PowerShell

Aperte a tecla **Windows**, digite **PowerShell** e abra o **Windows PowerShell**. Não precisa ser como administrador.

### 3. Rode o instalador

Copie e cole esta linha no PowerShell e aperte **Enter**:

```powershell
irm https://raw.githubusercontent.com/Junior331/agent-office/main/install.ps1 | iex
```

O instalador vai:
- conferir se você tem o **Node.js** e, se não tiver, perguntar se pode instalar (responda **S**);
- conferir se você tem o **Claude Code** e, se não tiver, perguntar se pode instalar (responda **S**);
- baixar a última versão do escritório e instalar em `%LOCALAPPDATA%\AgentOffice\app`;
- criar o atalho **Escritório de Agentes** na área de trabalho;
- abrir o escritório no navegador.

Tem que terminar com **"Pronto!"**.

> Se ele instalou o Node ou o Claude Code agora e depois reclamou que não achou, feche o PowerShell, abra de novo e rode a mesma linha.

### 4. Entre na sua conta do Claude (só uma vez)

Se o instalador avisou *"Falta entrar na sua conta do Claude"*, no PowerShell digite:

```powershell
claude
```

Ele abre o navegador pra você entrar na sua conta. Depois de logar, pode fechar o terminal.

### 5. Abra o escritório

Dê dois cliques no atalho **Escritório de Agentes** na área de trabalho. Ele abre em [http://localhost:4000](http://localhost:4000).

---

## 🧭 Primeiro uso

### Adicionar um projeto (um "andar")

1. No canto superior esquerdo do mapa, no **🏢 Prédio**, clique em **＋ Adicionar andar**.
2. Escolha um dos projetos que ele encontrou no seu computador, ou cole o caminho da pasta (ex.: `C:\Users\voce\Documents\meu-projeto`).
3. O andar aparece com o **Líder** esperando.

Qualquer pasta onde você abrir o Claude Code (no terminal ou no VS Code) também vira um andar sozinha.

### Falar com o Líder

1. Na lateral direita, abra a aba **Chat** e escolha **Líder**.
2. Escreva o que você quer. Exemplos:
   - *"Me explica em 5 linhas a estrutura deste projeto."*
   - *"/team criar a tela de login com validação de e-mail e senha, seguindo o padrão das outras telas."*
3. Ele trabalha sozinho e você vê ao vivo o que ele está fazendo. A resposta chega no chat, com botão **📋 Copiar**.

Com `/team`, o líder escreve um plano (spec) e **pede sua aprovação** antes de começar. Depois monta a equipe, e você vê cada agente trabalhando no mapa.

### Autonomia do Líder

No chat do Líder, escolha quanto ele pode fazer sem te perguntar:

| Nível | O que ele faz sozinho |
|---|---|
| **Cauteloso** | Lê o projeto, planeja e conversa. Pede antes de mexer no código. |
| **Equilibrado** (padrão) | Edita o projeto e roda lint, testes e build. Pede antes de instalar pacote, mexer no histórico do git ou rodar comando perigoso. |
| **Livre** | Tudo que o Claude Code conseguir. |

Em todos os níveis a equipe segue regras de segurança: o QA não mexe no código, ninguém lê seu `.env`, comandos destrutivos ficam bloqueados. Quando alguém precisa de uma permissão, aparece um card vermelho com **Aprovar / Negar / Responder**.

### O que tem em cada aba

- **Equipe**: quem está no time, o que cada um está fazendo, desempenho (🟢 🔵 🟡 🔴), pedidos esperando você, contratar e desligar.
- **Chat**: conversa com o Líder e com cada agente. O botão **⇤** expande o chat pra ler respostas grandes.
- **Histórico**: cada tarefa que os agentes fizeram, com tempo, resultado e tokens gastos.

---

## 🔄 Atualizações

O escritório confere se há versão nova a cada 6 horas. Quando houver, aparece um aviso no painel com **Atualizar agora**: ele baixa, instala e volta sozinho, em cerca de 1 minuto.

Também dá pra atualizar rodando de novo a linha do instalador.

---

## 📱 Celular (opcional, Telegram)

Dá pra falar com o Líder e aprovar pedidos pelo Telegram:

1. No Telegram, fale com **@BotFather**, mande `/newbot`, escolha um nome e copie o **token**.
2. No PowerShell:
   ```powershell
   cd "$env:LOCALAPPDATA\AgentOffice\app"
   npm run telegram:setup -- COLE_O_TOKEN_AQUI
   ```
3. Quando pedir, mande `/start` pro seu bot pelo celular.
4. Feche e abra o escritório pelo atalho.

No Telegram: escreva normalmente pra falar com o Líder, `/andares` troca de projeto, `/equipe` escolhe com quem falar, `/status` mostra o resumo. Só o seu chat é atendido.

---

## 🆘 Problemas comuns

**"Não encontrei o Claude Code neste computador"**
Feche o PowerShell, abra de novo e rode `claude --version`. Se não funcionar, reinstale com `npm install -g @anthropic-ai/claude-code`. Se ele estiver num caminho diferente, informe em `%USERPROFILE%\.agent-office\config.json`: `"claudePath": "C:/caminho/para/claude.exe"`.

**O Líder responde "Not logged in" ou "o Claude Code não está logado"**
O Claude Code do computador ainda não entrou na sua conta (ou o login expirou). Clique em **🔑 Entrar na conta do Claude** na resposta do Líder, ou abra o PowerShell e rode `claude`: escolha entrar com a sua conta do Claude, termine no navegador e digite `/exit`. Depois mande a mensagem de novo. O `/login` não funciona digitado no chat do escritório, porque ele precisa de uma janela de terminal.

**O escritório não abre no navegador**
Dê dois cliques no atalho de novo. Se ainda não abrir, veja se outro programa está usando a porta 4000 (feche e tente de novo) ou olhe o arquivo `%LOCALAPPDATA%\AgentOffice\app\office.log`.

**O Líder responde que uma ação foi negada**
É o nível de autonomia. Aumente no chat do Líder (ex.: de Cauteloso pra Equilibrado) ou aprove o pedido no card vermelho.

**O antivírus reclamou**
O instalador só baixa o escritório do GitHub e usa o Node e o Claude Code que você já tem. Se o antivírus bloquear, libere a pasta `%LOCALAPPDATA%\AgentOffice`.

**Quero ver o que está instalado**
```powershell
cd "$env:LOCALAPPDATA\AgentOffice\app"
npm run setup -- status
```

---

## 🗑️ Desinstalar

```powershell
cd "$env:LOCALAPPDATA\AgentOffice\app"
npm run setup -- uninstall
```

Isso tira os agentes, os comandos e os hooks do Claude Code. Depois, se quiser apagar tudo:
- a pasta `%LOCALAPPDATA%\AgentOffice` (o app);
- a pasta `%USERPROFILE%\.agent-office` (os dados dos seus times);
- o atalho da área de trabalho.

Nenhum projeto seu é alterado pelo escritório, então não há nada pra limpar neles.

---

## 🔒 Privacidade

- Tudo roda no seu computador. O escritório abre só em `localhost` e não aceita conexão de fora.
- O trabalho é feito pelo **seu** Claude Code, com a **sua** conta.
- Os dados dos times (planos, conversas, avaliações) ficam em `%USERPROFILE%\.agent-office`, **fora dos seus projetos**.
- Nada é enviado pra terceiros, exceto se você ligar o Telegram (aí as mensagens passam pelo Telegram).
- O escritório só acessa a internet pra conferir se há versão nova no GitHub.

---

## 🛠️ Instalação manual (macOS, Linux ou desenvolvimento)

Requisitos: Node 18+, Claude Code instalado e logado.

```bash
git clone https://github.com/Junior331/agent-office.git
cd agent-office
npm install
npm run setup
npm start
```

Abra [http://localhost:4000](http://localhost:4000). Depois disso, o escritório sobe sozinho sempre que você usar o Claude Code. No macOS e no Linux não há atalho nem atualização automática: pra atualizar, `git pull` e `npm run setup` de novo.

### Comandos

```
npm run setup                               instala ou atualiza (kit, agentes, comandos, hooks globais)
npm run setup -- status                     mostra o que está instalado e os andares
npm run setup -- migrate "<pasta>"          traz um projeto do kit antigo (.claude/team) pro modelo novo
npm run setup -- uninstall                  remove agentes, comandos e hooks (os dados ficam)
npm run telegram:setup -- <TOKEN_DO_BOT>    liga o Telegram
npm run simulate                            agentes de mentira pra testar a tela
```

### Publicar uma versão (quem mantém o projeto)

```bash
git tag v0.3.0 -m "o que mudou"
git push origin v0.3.0
```

O GitHub Actions monta o `agent-office.zip` e o `version.json` e cria a release. Os escritórios instalados mostram o aviso de atualização em até 6 horas.
