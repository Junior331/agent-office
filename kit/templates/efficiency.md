# Lições de economia de tokens

Mantido pelo líder (seção 13 do protocolo). As 5 primeiras linhas de "Regras ativas" vão no começo de todo disparo.

## Regras ativas
- Passe caminhos de arquivo, não o conteúdo; o agente lê só o trecho que precisa.
- Antes de ler um arquivo grande, use Grep/Glob pra achar a linha.
- Rode só os testes afetados (`playwright test <arquivo>`, `vitest <padrão>`); suíte inteira só no fechamento.
- Relatório com no máximo ~40 linhas; detalhes em evidência, não no texto.
- Uma tarefa pequena e clara por disparo vale mais que um pacote vago.

## Histórico
Formato: `- AAAA-MM-DD · <membro> · <tokens/disparo> (mediana <x>) · causa → lição`
