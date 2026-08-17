# Falatório

Um "Discord caseiro" para você e seus amigos: **chat de voz**, **chat de texto** e **compartilhamento de tela**. Sem cadastro, sem anúncios, sem servidor de terceiros no meio das suas conversas.

A voz e a tela vão **direto de um computador para o outro** (P2P, via WebRTC). O servidor só apresenta as pessoas umas às outras e entrega as mensagens de texto — ele nunca vê nem grava seu áudio.

```
┌──────────────┐        sinalização        ┌──────────────┐
│  Você (app)  │ ────────────────────────► │   Servidor   │
└──────┬───────┘                           └──────────────┘
       │  voz + tela direto (P2P)                 ▲
       ▼                                          │
┌──────────────┐ ─────────────────────────────────┘
│ Amigo (app)  │
└──────────────┘
```

---

## O que tem dentro

```
falatorio/
├── server/          ← servidor de sinalização (é isso que vai pro Render)
│   ├── server.js
│   └── public/      ← a interface (fonte única, usada pelo app e pelo navegador)
├── desktop/         ← app Electron (Windows / Mac / Linux)
│   ├── main.js
│   ├── preload.js
│   └── sync-ui.js   ← copia server/public → desktop/renderer
└── render.yaml      ← configuração de deploy
```

---

## Passo 1 — Subir o servidor (grátis, ~5 minutos)

O servidor precisa estar na internet com HTTPS, porque navegador e Electron só liberam microfone e captura de tela em conexão segura.

### Render (recomendado)

1. Crie um repositório no GitHub com esta pasta e mande o código para lá.
2. Entre em [render.com](https://render.com) → **New** → **Web Service** → conecte o repositório.
3. O Render lê o `render.yaml` sozinho. Se preferir configurar na mão:
   - **Root Directory:** `server`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
4. Ao terminar você recebe um endereço tipo `https://falatorio.onrender.com`. **Guarde esse endereço** — é o que todo mundo vai colocar no app.

> ⚠️ **O plano grátis hiberna** depois de ~15 minutos sem ninguém. A primeira pessoa que entrar pode esperar ~40 segundos enquanto ele acorda. É só isso — depois fica normal.

### Railway (alternativa)

`New Project` → `Deploy from GitHub` → em **Settings** defina o *root directory* como `server`. O start command já vem do `package.json`.

### Testando antes de subir

```bash
cd server
npm install
npm start
```

Abra `http://localhost:3000` em duas abas, entre com nomes diferentes e teste. Em `localhost` o navegador libera microfone mesmo sem HTTPS.

---

## Passo 2 — Gerar o app desktop

```bash
cd desktop
npm install
npm start          # abre o app para testar
```

Para deixar o endereço do servidor já preenchido para seus amigos (assim eles só digitam o nome):

```bash
# Linux / Mac
FALATORIO_SERVER=https://falatorio.onrender.com npm run dist

# Windows (PowerShell)
$env:FALATORIO_SERVER="https://falatorio.onrender.com"; npm run dist
```

Os instaladores saem em `desktop/dist/`:

| Sistema | Arquivo gerado | Comando |
|---|---|---|
| Windows | `Falatorio Setup 1.0.0.exe` | `npm run dist:win` |
| macOS | `Falatorio-1.0.0.dmg` | `npm run dist:mac` |
| Linux | `Falatorio-1.0.0.AppImage` | `npm run dist:linux` |

> Cada instalador precisa ser gerado no sistema correspondente (o `.dmg` só sai no Mac). Se você só tem Windows, gere o `.exe` e mande para os amigos de Windows — quem estiver em outro sistema pode simplesmente abrir o endereço do servidor no Chrome, que a interface é a mesma.

**Aviso de "app não verificado":** como o instalador não é assinado digitalmente (assinatura custa dinheiro por ano), o Windows mostra a tela azul do SmartScreen — é só clicar em *Mais informações* → *Executar assim mesmo*. No Mac: botão direito no app → *Abrir*.

---

## Como usar

1. Abra o app, digite seu nome e o endereço do servidor, clique em **Entrar na sala**.
2. Todo mundo cai no mesmo canal `#geral`. Quem está conectado aparece na barra da esquerda, com o nome iluminado quando fala.
3. **🎙️ Mudo** — corta seu microfone: os outros param de te ouvir.
4. **🔈 Ensurdecer** — você para de ouvir todo mundo. Como no Discord, isso também fecha seu microfone (se você não está ouvindo, não faz sentido continuar sendo ouvido sem saber). Ao desfazer, o microfone volta como estava antes.
5. **🔊 ao lado de cada nome** — silencia **só aquela pessoa**, e só para você. Ninguém mais é afetado e a pessoa não fica sabendo.
6. **🖥️ Compartilhar tela** — abre um seletor com suas telas e janelas; escolha uma e ela aparece para todos. Clique de novo para parar.
7. **⚙️ Qualidade** — escolhe como sua tela é enviada. Vale trocar a qualquer momento, inclusive no meio do compartilhamento.
8. **⏻ Sair** — desconecta e volta para a tela inicial.

O chat de texto fica embaixo. As mensagens são **só da sessão**: quando você fecha o app, elas somem (era o combinado — nada é salvo em banco de dados).

### Escolhendo a qualidade

| Opção | Resolução | Quadros | Banda de subida | Quando usar |
|---|---|---|---|---|
| Leve | 720p | 15 fps | ~0,8 Mbps | Internet fraca, ou mostrar código/texto (prioriza nitidez) |
| Média | 1080p | 30 fps | ~2,5 Mbps | Padrão, serve para quase tudo |
| Alta | 1080p | 60 fps | ~5 Mbps | Jogos e vídeo, quando a fluidez importa |

Lembre que a conexão é em malha: **a banda é multiplicada pelo número de pessoas te assistindo**. Compartilhar em Alta para 4 pessoas pede uns 20 Mbps de upload. Se a tela travar do lado dos outros, baixar para Média ou Leve resolve na hora — a troca é instantânea e não derruba a chamada.

### Escolhendo qual tela assistir

Quando duas ou mais pessoas compartilham ao mesmo tempo, aparece uma barra em cima com **Todas** e o nome de cada uma. Clique num nome para ver só aquela tela, em tamanho cheio; clique em **Todas** para voltar à grade. Clicar direto no quadro faz a mesma coisa.

As telas escondidas ficam pausadas, o que economiza processador. A imagem continua chegando pela rede — para realmente cortar o consumo de banda de quem você não assiste seria preciso renegociar a conexão, o que traz de volta justamente a instabilidade que o projeto evita.

---

## Detalhes que vale saber

**Quantas pessoas cabem?** A conexão é em malha: cada pessoa manda o próprio áudio para cada uma das outras. Funciona muito bem **até 6–8 pessoas**. Acima disso a internet de quem compartilha tela começa a sofrer. O limite está em `MAX_USERS` (padrão 12) — dá para mudar nas variáveis de ambiente do Render.

**Se a voz não conectar para alguém.** Algumas redes (universidade, empresa, alguns provedores com CGNAT) bloqueiam conexão direta. O app já vem com um servidor TURN público de cortesia (Open Relay) que resolve a maioria desses casos, mas ele é compartilhado com o mundo inteiro e pode ficar lento. Se isso incomodar, crie uma conta grátis em [metered.ca](https://www.metered.ca/tools/openrelay/) ou suba um `coturn`, e troque a lista `ICE_SERVERS` no topo de `server/public/app.js`.

**Áudio da tela.** Hoje o compartilhamento envia só imagem, não o som do que está tocando. Dá para adicionar (`audio: true` no `getDisplayMedia`, e `audio: 'loopback'` no handler do Electron), mas o comportamento varia bastante entre Windows, Mac e Linux — por isso ficou de fora da versão básica.

**Editando a interface.** Mexa sempre em `server/public/`. O `npm start` e o `npm run dist` do desktop copiam essa pasta para `desktop/renderer/` automaticamente — não edite `desktop/renderer/` direto, porque ela é sobrescrita.

**Privacidade.** O servidor guarda em memória apenas nome e id de quem está online, e apaga quando a pessoa sai. Nada em disco, nada em banco de dados.

---

## Testado

Verificado com clientes reais (Chromium automatizado) rodando ao mesmo tempo, e com o próprio app Electron:

- malha completa de **6 participantes** — todas as conexões em `iceConnectionState: connected`;
- áudio realmente trafegando (bytes recebidos > 0 no `getStats`), não só "conectado no papel";
- tela compartilhada chegando em todos, com frames decodificados de verdade;
- quem entra **no meio** de um compartilhamento já vê a tela;
- **duas telas ao mesmo tempo**, e cada uma somindo ao ser encerrada;
- pessoa saindo no meio da conversa: todos atualizam a lista e a grade;
- chat nos dois sentidos, estado de mudo propagando;
- mensagens com HTML são escapadas (sem injeção via chat);
- no app Electron: janela, ponte do preload, seletor de telas e captura ativa;
- **ensurdecer** silencia todos os áudios e fecha o microfone, e desfazer restaura o estado anterior;
- **silenciar uma pessoa** afeta só ela e só para quem clicou (verificado nas outras sessões);
- **qualidade** aplicada de verdade no envio (bitrate e fps conferidos no `getStats`), com troca ao vivo sem derrubar a conexão e sem perder frames;
- **seleção de tela**: abas aparecem só com duas ou mais, foco esconde e pausa as outras, e a visão volta sozinha para "Todas" quando quem você assistia para de compartilhar.

Durante esses testes apareceram dois problemas reais, que estão corrigidos no código:

1. **Conexões travando em `new` a partir de 3–4 pessoas.** Duas ofertas cruzavam no ar (*glare*) e a negociação morria. Agora cada par tem um ofertante fixo (o de id menor) e toda a sinalização daquele par passa por uma fila, então nada é aplicado fora de ordem.
2. **Tela não chegava em um dos pares.** O espaço do vídeo é reservado na conexão e compartilhar a tela virou um `replaceTrack` — sem renegociar nada. Quem responde à oferta adota o transceiver que vem nela (`adoptVideo`), senão a resposta sairia como "só recebo" e essa pessoa nunca conseguiria enviar a própria tela.

Se algum dia der problema de conexão, abra a interface no navegador com `?debug=1` no fim do endereço: todo o vaivém da sinalização aparece no console.

---

## Atualizando o servidor depois de mexer no código

Se você já tem o serviço no Render ligado ao GitHub, é só mandar os arquivos novos para o repositório — o Render redesenha sozinho a cada commit:

1. Abra o repositório no GitHub → **Add file** → **Upload files**
2. Arraste a pasta `server` atualizada (pode sobrescrever, o GitHub entende como alteração)
3. **Commit changes**
4. No Render, o deploy começa em alguns segundos; acompanhe em **Logs** até o status voltar a **Live**

Quem usa pelo navegador já pega a versão nova ao recarregar a página. Quem usa o app instalado precisa de um instalador novo (`npm run dist`) **só se a interface mudou** — como a interface vem embutida no app, mudanças em `server/public/` exigem regerar o instalador.

---

## Ideias para depois

Se um dia quiserem crescer: múltiplos canais de voz e texto, histórico salvo em SQLite, sala protegida por senha, câmera além da tela, ou trocar a malha por um servidor SFU (mediasoup) para aguentar dezenas de pessoas. A base já está pronta para qualquer um desses caminhos.
