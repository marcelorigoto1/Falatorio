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
3. **🎙️ Mudo** — corta seu microfone (o botão fica vermelho).
4. **🖥️ Compartilhar tela** — abre um seletor com suas telas e janelas; escolha uma e ela aparece para todos. Clique de novo para parar.
5. **⏻ Sair** — desconecta e volta para a tela inicial.

O chat de texto fica embaixo. As mensagens são **só da sessão**: quando você fecha o app, elas somem (era o combinado — nada é salvo em banco de dados).

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
- no app Electron: janela, ponte do preload, seletor de telas e captura ativa.

Durante esses testes apareceram dois problemas reais, que estão corrigidos no código:

1. **Conexões travando em `new` a partir de 3–4 pessoas.** Duas ofertas cruzavam no ar (*glare*) e a negociação morria. Agora cada par tem um ofertante fixo (o de id menor) e toda a sinalização daquele par passa por uma fila, então nada é aplicado fora de ordem.
2. **Tela não chegava em um dos pares.** O espaço do vídeo é reservado na conexão e compartilhar a tela virou um `replaceTrack` — sem renegociar nada. Quem responde à oferta adota o transceiver que vem nela (`adoptVideo`), senão a resposta sairia como "só recebo" e essa pessoa nunca conseguiria enviar a própria tela.

Se algum dia der problema de conexão, abra a interface no navegador com `?debug=1` no fim do endereço: todo o vaivém da sinalização aparece no console.

---

## Ideias para depois

Se um dia quiserem crescer: múltiplos canais de voz e texto, histórico salvo em SQLite, sala protegida por senha, câmera além da tela, ou trocar a malha por um servidor SFU (mediasoup) para aguentar dezenas de pessoas. A base já está pronta para qualquer um desses caminhos.
