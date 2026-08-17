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

## Passo 1.5 — Definir a senha da sala

A senha **não fica no código**. Ela vive numa variável de ambiente, que só você enxerga no painel do Render.

> Um esclarecimento útil: o `.gitignore` sozinho não protege senha nenhuma. Ele só impede que um arquivo seja enviado ao repositório — se a senha estivesse escrita dentro do `server.js`, ela iria junto do mesmo jeito. Por isso a senha entra por fora, como variável de ambiente.

### No Render

1. Abra seu serviço → **Environment** (menu da esquerda)
2. **Add Environment Variable**
3. **Key:** `ROOM_PASSWORD` — **Value:** a senha combinada (por exemplo `frunos`)
4. **Save changes** — o Render reinicia o serviço sozinho

Pronto: a tela de entrada passa a pedir senha. Para trocar a senha depois, basta editar esse valor; para abrir a sala para qualquer um, apague a variável.

### Rodando na sua máquina

```bash
cd server
cp .env.example .env      # depois edite o .env e ponha a senha
npm start
```

O arquivo `.env` está no `.gitignore` e nunca vai para o GitHub.

### Como a senha é protegida

- É conferida **no servidor**, nunca no navegador — não adianta mexer no código da página.
- A comparação é de tempo constante, para não vazar pistas pelo tempo de resposta.
- Cada resposta a uma senha errada demora 0,6s de propósito, e **8 erros travam aquele IP por 10 minutos** — inclusive para a senha certa, para o atacante não descobrir que acertou.
- Quem erra a senha não é registrado na sala nem recebe a lista de quem está online.

Sendo honesto sobre o alcance disso: é uma senha compartilhada entre amigos, do tipo "tranca na porta". Serve muito bem para evitar estranhos entrando na conversa. Não é um sistema de contas individuais — quem sabe a senha entra com o nome que quiser.

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

1. Abra o app, digite seu nome, o endereço do servidor e a senha da sala, clique em **Entrar na sala**.
2. Todo mundo cai no mesmo canal `#geral`. Quem está conectado aparece na barra da esquerda, com o nome iluminado quando fala.
3. **🎙️ Mudo** — corta seu microfone: os outros param de te ouvir.
4. **🔈 Ensurdecer** — você para de ouvir todo mundo. Como no Discord, isso também fecha seu microfone (se você não está ouvindo, não faz sentido continuar sendo ouvido sem saber). Ao desfazer, o microfone volta como estava antes.
5. **🔊 ao lado de cada nome** — silencia **só aquela pessoa**, e só para você. Ninguém mais é afetado e a pessoa não fica sabendo.
6. **🖥️ Compartilhar tela** — abre um seletor com suas telas e janelas; escolha uma e ela aparece para todos. Clique de novo para parar.
7. **Enviar o som junto** — quando marcado, o som do que está tocando (o jogo, o vídeo) vai junto com a imagem.
8. **⚙️ Qualidade** — escolhe como **sua** tela é enviada. Vale trocar a qualquer momento, inclusive no meio do compartilhamento.
9. **⏱️ Atraso** — escolhe quanto **você** segura as telas dos outros antes de exibir, para elas não engasgarem.
10. **⏻ Sair** — desconecta e volta para a tela inicial.

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

### O som da transmissão

Cada conexão reserva **dois canais de áudio**: um para a sua voz e outro para o som da sua tela. Eles viajam separados de propósito, e é isso que permite, do lado de quem assiste, um controle de volume só para a transmissão — passe o mouse sobre o quadro e aparece um slider no canto. Dá para deixar o jogo baixinho e continuar ouvindo a galera normalmente, ou silenciar o jogo sem silenciar ninguém.

A voz também recebe um tratamento diferente do som do jogo: a voz passa por cancelamento de eco e supressão de ruído, enquanto o som da tela vai cru, sem esses filtros — eles são ótimos para fala e péssimos para música.

**Onde funciona:** no Windows, tanto no app quanto no Chrome. No Chrome você precisa marcar *"Compartilhar áudio da guia"* na janelinha de seleção. No Mac e no Linux o sistema operacional normalmente não deixa capturar o som interno; nesse caso a tela é compartilhada só com imagem e o app avisa por mensagem, sem quebrar nada.

### O atraso (suavidade)

Quando a internet oscila, os pedacinhos de vídeo chegam desencontrados e a tela engasga. Segurar a imagem por meio segundo antes de exibir dá tempo dos pedaços atrasados chegarem, e a reprodução fica lisa.

| Opção | Efeito |
|---|---|
| Sem atraso | Você vê o que está acontecendo agora, mas pode travar quando a rede oscila |
| 0,5s (padrão) | Absorve os engasgos comuns sem atrapalhar a conversa |
| 1,5s | Bem suave, para internet ruim de verdade |

Duas coisas importantes: a escolha é **sua e só sua** — você define como quer ver os outros, sem afetar ninguém. E **a voz nunca é atrasada**, só a tela e o som dela. Conversa precisa ser em tempo real; por isso, com 1,5s de atraso, você vai ouvir alguém comentar uma jogada um instante antes de vê-la.

---

## Detalhes que vale saber

**Quantas pessoas cabem?** A conexão é em malha: cada pessoa manda o próprio áudio para cada uma das outras. Funciona muito bem **até 6–8 pessoas**. Acima disso a internet de quem compartilha tela começa a sofrer. O limite está em `MAX_USERS` (padrão 12) — dá para mudar nas variáveis de ambiente do Render.

**Se a voz não conectar para alguém.** Algumas redes (universidade, empresa, alguns provedores com CGNAT) bloqueiam conexão direta. O app já vem com um servidor TURN público de cortesia (Open Relay) que resolve a maioria desses casos, mas ele é compartilhado com o mundo inteiro e pode ficar lento. Se isso incomodar, crie uma conta grátis em [metered.ca](https://www.metered.ca/tools/openrelay/) ou suba um `coturn`, e troque a lista `ICE_SERVERS` no topo de `server/public/app.js`.

**Consumo do servidor.** O plano grátis do Render dá 512 MB de RAM e 0,1 CPU. Este servidor usa cerca de **70 MB** parado e cresce pouquíssimo com gente na sala: ele só guarda nome e id de quem está online e repassa textinhos de sinalização. Voz e vídeo nem passam por ele. Os limites que realmente importam são a hibernação após 15 minutos e as 750 horas por mês — memória não é preocupação aqui.

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
- **seleção de tela**: abas aparecem só com duas ou mais, foco esconde e pausa as outras, e a visão volta sozinha para "Todas" quando quem você assistia para de compartilhar;
- **senha**: senha errada é recusada, não entra na sala e nem sequer é registrada no servidor; 8 erros travam o IP por 10 minutos, e durante o castigo nem a senha certa passa;
- **som da transmissão**: a conexão carrega mesmo 2 canais de áudio + 1 de vídeo, os dois áudios chegam simultaneamente, tocam em players separados, e o slider do quadro mexe só no som da transmissão — a voz continua intacta;
- **atraso**: 0,5s aplicado na tela e no som dela, com a voz ficando em 0; trocar para 1,5s ou 0 reconfigura os receptores na hora.

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
