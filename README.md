# Falatório

Um "Discord caseiro" para você e seus amigos: **chat de voz**, **chat de texto**, **compartilhamento de tela** e **webcam** — no computador e **no celular**. Sem cadastro, sem anúncios, sem servidor de terceiros no meio das suas conversas.

Voz, tela e câmera vão **direto de um computador para o outro** (P2P, via WebRTC). O servidor só apresenta as pessoas umas às outras e entrega as mensagens de texto — ele nunca vê nem grava seu áudio.

```
┌──────────────┐        sinalização        ┌──────────────┐
│  Você (app)  │ ────────────────────────► │   Servidor   │
└──────┬───────┘                           └──────────────┘
       │  voz + tela + câmera direto (P2P)        ▲
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

### Servidor na sua própria máquina

Também dá para rodar o servidor em casa, sem Render nenhum. O que muda:

**Não deixa a chamada mais rápida.** Voz e tela já vão direto de um computador para o outro; o servidor nunca toca nelas. O que você ganha é não depender de terceiro e acabar com a hibernação de 15 minutos.

**A pegadinha é o HTTPS**, e ela depende de como cada um entra:

| Quem entra | Servidor em `http://` puro (sem certificado) |
|---|---|
| Pelo **app instalado** | Funciona, microfone incluído — a interface vem de arquivo local, que o navegador já considera seguro |
| Pelo **navegador**, por IP | **Não funciona**: sem HTTPS o `navigator.mediaDevices` nem existe, então não há microfone nem tela |
| Pelo navegador, em `localhost` | Funciona (exceção da regra, vale só para quem está na própria máquina) |

Ou seja: se todo mundo usar o app instalado, um servidor caseiro em HTTP simples resolve. Se alguém for usar pelo navegador, precisa de HTTPS.

**No Brasil tem um obstáculo a mais:** muitos provedores usam CGNAT, então você não tem IP público de verdade e abrir porta no roteador não adianta. O caminho que passa por cima disso — e ainda entrega HTTPS de graça — é um túnel:

```powershell
# 1) suba o servidor (dentro da pasta server; ou clique em iniciar-windows.bat)
npm install
npm start

# 2) noutra janela, exponha com um endereço HTTPS temporário
cloudflared tunnel --url http://localhost:3000
```

O `cloudflared` imprime um endereço `https://algo.trycloudflare.com` — é esse que a galera põe no campo "Servidor". Não precisa abrir porta, não precisa de IP fixo, e funciona atrás de CGNAT. Para um endereço fixo, dá para criar um túnel nomeado com um domínio seu, também sem custo.

Duas notas práticas: o computador precisa ficar ligado enquanto vocês usam, e a senha da sala continua vindo do `.env` (copie o `.env.example`).

**O que um servidor no Brasil melhoraria de verdade** é outra coisa: o servidor **TURN**. Ele só entra quando a conexão direta falha, e o TURN público que vem configurado fica no exterior — nesse caso o áudio dá a volta pelo mundo. Subir um `coturn` aqui resolveria justamente essa situação, mas ele precisa de portas UDP abertas, o que o CGNAT impede. Fica como ideia para quem tiver IP público.

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
6. **🖥️ Compartilhar tela** — abre um diálogo para escolher a tela ou janela **e se vai com som**. Clique de novo para parar.
7. **📷 Ligar câmera** — manda sua webcam para a sala (explicado abaixo). Clique de novo para desligar.
8. **🎧 Ouvir a chamada em** — escolhe por qual aparelho você ouve as vozes. Aparece quando há mais de uma saída de áudio, e é a chave para transmitir só o som do jogo (explicado abaixo).
9. **⚙️ Qualidade** — escolhe como **sua** tela é enviada. Vale trocar a qualquer momento, inclusive no meio do compartilhamento.
10. **⏱️ Atraso** — escolhe quanto **você** segura as telas dos outros antes de exibir, para elas não engasgarem.
11. **📣 Modo Fiore** — efeitos sonoros nos acontecimentos da sala (explicado abaixo).
12. **⏻ Sair** — desconecta e volta para a tela inicial.

Clique em **# geral** para esconder ou mostrar o chat, e em **♪ música** para abrir a fila.

Nos quadros das transmissões: **⤢** maximiza (ocupa também a área do chat), **⛶** abre em tela cheia do sistema, **✕** sai daquela transmissão, e o slider do canto controla o volume do som dela.

O chat de texto fica embaixo. As mensagens são **só da sessão**: quando você fecha o app, elas somem (era o combinado — nada é salvo em banco de dados).

### A webcam

O botão **📷 Ligar câmera** manda seu rosto para a sala. Alguns detalhes que valem saber:

- **A câmera é um quadro à parte da tela.** Se você estiver compartilhando tela *e* com a câmera ligada, os outros veem dois quadros seus, cada um com nome próprio (`Você` e `Você 📷`). Dá para maximizar, focar ou fechar cada um separadamente.
- **A sua prévia vem espelhada**, como num espelho de verdade. Só a sua — para os outros você aparece do jeito certo.
- **A câmera não entra no atraso.** O botão ⏱️ segura só as telas; rosto e voz precisam andar no mesmo passo, senão a boca descola do som.
- **Banda própria e modesta**: 720p a 30 fps, limitada a ~1,2 Mbps, independente do preset de qualidade da tela. Mesmo transmitindo em Alta, a câmera não rouba espaço do jogo.
- **Mais de uma câmera?** Um seletor 🎥 aparece embaixo do botão assim que o app enxerga duas ou mais. A escolha fica lembrada.
- Quem tem a câmera ligada aparece com **📷** na lista da sala.
- Ligar e desligar **não renegocia a conexão** — o canal da câmera já nasce reservado, como o da tela. Ninguém perde o quadro de ninguém quando você mexe na sua.

### Pelo celular

Basta abrir o endereço do servidor no navegador do telefone — **não precisa instalar nada**. A interface se dobra sozinha: barra de baixo com o que o polegar usa (mudo, surdo, câmera, chat), a lista da sala e os ajustes viram uma **gaveta** no ☰, e chat e música cobrem a tela inteira quando você os abre.

Pelo celular você pode:

- **falar e ouvir** normalmente;
- **ligar a câmera**, com um botão **🔄 Virar** para alternar entre a frontal e a traseira (a escolha fica lembrada, e a traseira não vem espelhada);
- **mandar e ler** mensagens no chat, com contador de não lidas no botão;
- **assistir** as telas e câmeras de quem está no PC, inclusive maximizar e focar numa só;
- **mexer na fila de música** junto com todo mundo.

**O que NÃO dá pelo celular: transmitir a sua tela.** Nenhum navegador de celular oferece isso — nem o Chrome do Android, nem o Safari do iPhone. Não é limitação do Falatório: a API de captura de tela simplesmente não existe nesses navegadores (no iPhone ela nem aparece; no Android ela aparece mas nunca entrega imagem). Por isso o botão fica apagado e escrito **"Tela (só no PC)"**, e tocar nele explica o motivo em vez de abrir um diálogo que terminaria em erro. Para transmitir tela, é pelo computador.

Duas coisas do servidor importam aqui: ele precisa estar em **HTTPS** (o Render já é), porque nenhum navegador libera microfone e câmera fora disso, e **todos precisam usar o mesmo endereço**.

### Como os quadros se arrumam no palco

Os quadros **não ficam simplesmente lado a lado**. Toda vez que algo muda de tamanho, o app calcula qual número de colunas rende o **maior quadro possível** no espaço que existe — largura e altura ao mesmo tempo, mantendo a proporção 16:9.

Com quatro transmissões num monitor comum isso dá **2×2**, e não uma fileira de quatro tirinhas com metade do palco vazio embaixo: cada quadro fica cerca de **80% mais largo**. Num palco estreito e alto (janela em meia tela, por exemplo), os mesmos quadros empilham numa coluna só.

Isso não dava para resolver só no CSS, porque a escolha depende da largura **e** da altura juntas. O recálculo acontece sozinho quando você redimensiona a janela, esconde o chat, abre o painel de música ou alguém entra e sai — e um quadro sozinho (por foco ou por maximizar) continua esticando para o palco inteiro, como antes.

O chat também ficou mais econômico: ele quase sempre está parado, e cada pixel que não usa vira imagem maior. Se quiser tudo para as transmissões, clique em **# geral** para escondê-lo por completo.

### Escolhendo a qualidade

| Opção | Resolução | Quadros | Banda de subida | Quando usar |
|---|---|---|---|---|
| Leve | 720p | 15 fps | ~0,8 Mbps | Internet fraca, ou mostrar código/texto (prioriza nitidez) |
| Média | 1080p | 30 fps | ~2,5 Mbps | Padrão, serve para quase tudo |
| Alta | 1080p | 60 fps | ~5 Mbps | Jogos e vídeo, quando a fluidez importa |

Lembre que a conexão é em malha: **a banda é multiplicada pelo número de pessoas te assistindo**. Compartilhar em Alta para 4 pessoas pede uns 20 Mbps de upload. Se a tela travar do lado dos outros, baixar para Média ou Leve resolve na hora — a troca é instantânea e não derruba a chamada.

### Escolhendo qual tela assistir

Quando duas ou mais pessoas compartilham ao mesmo tempo, aparece uma barra em cima com **Todas** e o nome de cada uma. Clique num nome para ver só aquela tela; clique em **Todas** para voltar à grade. Clicar direto no quadro faz a mesma coisa.

As telas escondidas ficam pausadas, o que economiza processador. A imagem continua chegando pela rede — para realmente cortar o consumo de banda de quem você não assiste seria preciso renegociar a conexão, o que traz de volta justamente a instabilidade que o projeto evita.

**Maximizar (⤢):** a transmissão passa a ocupar tudo — inclusive o espaço onde fica o chat. Dá para acionar pelo botão ⤢ do quadro, por dois cliques no quadro, ou pela tecla **F**. É só layout, dentro da janela do app: você continua vendo a lista de participantes e os controles. Sai com **Esc**, com a tecla **F** de novo, ou pelo botão ⤡.

**Tela cheia do sistema (⛶):** a transmissão toma a tela inteira do monitor. Pelo botão ⛶ ou por **Shift+F**; sai com **Esc**, ao trocar de janela (Alt+Tab), ou quando a transmissão acaba.

No app desktop, a tela cheia é da **janela**, não a do HTML. A diferença importa: a versão HTML deixava a janela cobrindo o sistema sem um caminho confiável de volta, e era o que fazia o Alt+Tab e o botão Windows parecerem travados. Agora existem três saídas garantidas, e a janela nunca fica por cima de tudo.

**Esconder o chat:** clique em **# geral** na barra lateral. O chat recolhe e as telas ganham o espaço; clique de novo para trazer de volta. Enquanto está fechado, as mensagens novas aparecem como um contador ao lado do nome do canal, e a preferência é lembrada na próxima vez que você entrar.

Quando existe uma tela só no palco — porque só uma pessoa está transmitindo, porque você focou numa, ou porque maximizou — ela deixa de ser um cartão 16:9 e estica para usar todo o espaço disponível.

**Sair de uma transmissão:** o botão ✕ no canto do quadro. Aquela tela some e o som dela é cortado — você continua na sala, conversando normalmente, só não assiste mais. Para voltar, clique no nome dela (que fica riscado) na barra **Assistindo**. Se a pessoa parar de transmitir e começar de novo, a transmissão nova já vem aberta.

No seu próprio quadro, o ✕ apenas esconde a sua prévia; você continua compartilhando para os outros.

### O som da transmissão

A escolha acontece **na hora de transmitir**: ao clicar em *Compartilhar tela* abre um diálogo onde você escolhe a janela (no app) e decide entre **Sem som** e **Som do computador**. O padrão é sem som — nada vai junto sem você pedir. A última escolha fica lembrada.

Cada conexão reserva **dois canais de áudio**: um para a sua voz e outro para o som da sua tela. Eles viajam separados de propósito, e é isso que permite, do lado de quem assiste, um controle de volume só para a transmissão — passe o mouse sobre o quadro e aparece um slider no canto. Dá para deixar o jogo baixinho e continuar ouvindo a galera, ou silenciar o jogo sem silenciar ninguém.

A voz também recebe tratamento diferente do som do jogo: a voz passa por cancelamento de eco e supressão de ruído, enquanto o som da tela vai cru, sem esses filtros — eles são ótimos para fala e péssimos para música.

**Onde funciona:**

| Como você compartilha | Sai som? |
|---|---|
| App desktop, Windows 10 2004+ 64 bits | Sim — **só do aplicativo escolhido**, ou do sistema todo |
| App desktop, Windows mais antigo ou 32 bits | Sim, mas só a mistura do sistema |
| App desktop, Mac ou Linux | Não — o sistema não libera |
| Chrome, **guia** do navegador | Sim, marcando *"Compartilhar áudio da guia"* |
| Chrome, **tela inteira** (Windows) | Sim, marcando *"Compartilhar áudio do sistema"* |
| Chrome, **janela solta** | Não — o Chrome não captura áudio de janelas |

Quando o som não vem, o app diz o motivo exato daquele caso, em vez de um aviso genérico. E quem está transmitindo com som aparece com um 🔊 ao lado do nome na lista, então dá para conferir na hora se está saindo mesmo.

### Som só de um aplicativo (o jeito bom)

**No app desktop, no Windows 10 (build 2004+) 64 bits**, o diálogo oferece uma terceira opção: **Som só de um aplicativo**. Você escolhe o programa numa lista e vai apenas o som dele — sem as vozes da chamada, sem notificações, sem o resto da máquina. Se você escolher compartilhar uma janela, o app já tenta adivinhar qual programa é e deixa ele pré-selecionado.

Por que isso precisou de código nativo: o navegador não sabe separar áudio por programa. Ele só entrega o som de uma guia ou a mistura inteira da saída de áudio. Quem sabe separar é o **Windows**, através da Application Loopback API (a mesma que o OBS usa no "Application Audio Capture"), e o Chromium nunca expôs essa API para o JavaScript. Então o Falatório usa uma biblioteca nativa (`loopback-capture`) no processo principal do Electron: ela entrega o áudio bruto do processo escolhido, que atravessa para a interface e vira uma faixa da chamada — indo pelo canal de som da transmissão que já existe, sem renegociar nada.

O binário já vem compilado no pacote, então **ninguém precisa instalar compilador**. E tudo é opcional: se a biblioteca não carregar (outro sistema, Windows antigo, 32 bits), a opção simplesmente não aparece e o resto do app funciona igual.

### Quando só existe "Som do computador"

Fora daquele caso — no navegador, ou no Mac e Linux — vale a limitação de sempre: o que sai é a *mistura final da saída de áudio*, incluindo as vozes da chamada, que voltam como eco.

Se isso incomodar e você não puder usar o app no Windows, dá para separar as saídas:

1. Deixe o **jogo tocando na saída principal** (as caixas de som, por exemplo).
2. Na barra lateral, em **🎧**, escolha ouvir a chamada **em outro aparelho** (um fone USB, um headset Bluetooth).
3. Compartilhe com **Som do computador**.

Como a captura pega a mistura da saída principal e as vozes agora saem por outro aparelho, vai só o som do jogo. Esse seletor só aparece quando o sistema tem mais de uma saída disponível.

### Música para a sala inteira

Clique em **♪ música** na barra lateral. Você busca pelo nome ou cola um link do YouTube, e a música toca **para todo mundo ao mesmo tempo** — com fila, pular, pausar e volume individual.

Também funciona por comandos no chat, como nos bots:

| Comando | O que faz |
|---|---|
| `/tocar <nome ou link>` | Busca e põe na fila |
| `/pular` | Passa para a próxima |
| `/pausar` e `/voltar` | Pausa e retoma para todos |
| `/fila` | Abre o painel |

**Como funciona por dentro, e por que assim.** O jeito clássico dos bots do Discord era baixar o áudio do YouTube e injetá-lo na chamada. Foi exatamente isso que derrubou o Groovy e o Rythm em 2021, quando o Google mandou notificação extrajudicial: aquilo viola os termos do YouTube.

Aqui o desenho é outro. O servidor **não toca e não transmite áudio nenhum** — ele guarda apenas *qual vídeo* e *em que segundo*. O player oficial do YouTube roda na máquina de cada pessoa, no mesmo trecho, e a cada 5 segundos o servidor manda uma batida de sincronia; quem escorregou mais de 1,5s se corrige sozinho.

Isso rende três vantagens práticas, além de não depender de nada proibido:

- o áudio chega **em qualidade cheia**, direto do YouTube, sem ser reencodado para caber no canal de voz (é por isso que música em bot soa abafada);
- **não gasta o upload de ninguém** — cada pessoa recebe do YouTube, não de você;
- quem entra no meio **cai no ponto exato** em que a música está.

**Busca por nome (opcional).** Para procurar pelo nome, o servidor precisa de uma chave da API do YouTube na variável `YOUTUBE_API_KEY` — é grátis, e a cota diária dá cerca de 100 buscas. Pegue em `console.cloud.google.com`: criar projeto → ativar "YouTube Data API v3" → Credenciais → Criar chave de API. **Sem a chave, colar o link continua funcionando normalmente**, inclusive pegando o título do vídeo.

Duas coisas que valem saber: vídeos cujo dono proíbe reprodução fora do YouTube são pulados automaticamente, com aviso no chat; e a fila é zerada quando a sala esvazia, para ninguém entrar horas depois no meio do que ficou tocando.

### Modo Fiore

O botão **📣 Modo Fiore**, logo acima do Sair, liga os efeitos sonoros da sala:

| Acontecimento | Som |
|---|---|
| Alguém entra na call (inclusive você) | "voltei hein galera" |
| Alguém sai | "que que eu saia" |
| Alguém abre a stream | sorteia entre os dois áudios de stream |
| Alguém se muta (inclusive você) | "tá mutado" |

Três decisões que valem explicar:

**É individual e local.** Você liga para você; nada disso trafega pela chamada nem chega no ouvido de quem não ligou. Vem desligado por padrão — ninguém devia ser recebido por um efeito sonoro sem ter pedido — e a escolha é lembrada.

**Tem freio.** Em bagunça — todo mundo entrando junto, alguém batendo no botão de mudo — isso viraria uma salada. Então só toca um efeito por vez (700 ms entre um e outro) e o mesmo evento não se repete antes de 2,5 s.

**Respeita o ensurdecer.** Se você está com 🎧 ligado, os efeitos também ficam calados: você pediu silêncio, então é silêncio.

Os arquivos ficam em `server/public/sons/`. Para trocar por outros, basta substituir mantendo os nomes (`entrar.ogg`, `sair.mp3`, `stream-1.ogg`, `stream-2.ogg`, `mutado.ogg`) — e dá para pôr quantos quiser no sorteio da stream, mexendo na lista no topo do `app.js`.

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

**A parte nativa.** O `desktop/app-audio.js` é o único lugar que toca a biblioteca nativa, e ele degrada sozinho: fora do Windows nem tenta carregar, e qualquer falha vira "opção indisponível" em vez de erro. Para depurar o caminho do áudio sem Windows, rode o app com `FALATORIO_FAKE_PCM=1` — a captura é substituída por um tom de 440 Hz no mesmo formato, e todo o resto (IPC, worklet, WebRTC) funciona igual.

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
- **atraso**: 0,5s aplicado na tela e no som dela, com a voz ficando em 0; trocar para 1,5s ou 0 reconfigura os receptores na hora;
- **diálogo de compartilhamento**: começa em "sem som", mostra o aviso ao escolher o som do computador, cancela por botão e por Esc, lembra a última escolha, e no app desktop traz a lista de janelas junto do aviso de plataforma;
- **tela cheia**: medida por geometria — o quadro precisa mesmo ocupar a viewport inteira, inclusive com o modo foco ligado, e não só reportar que entrou em tela cheia;
- **maximizar**: o quadro cobre a altura toda, o chat some, o botão vira "restaurar", e nada disso depende da API de tela cheia — F, duplo clique e Esc conferidos;
- **chat retrátil**: esconde e mostra pelo #geral, o espaço vai para as telas, o contador de não lidas aparece e zera, e a preferência sobrevive a recarregar a página;
- os atalhos de teclado não disparam enquanto se digita no chat;
- **no app Electron de verdade**: a captura pede `audio: true` e `systemAudio: include`; a tela cheia é da janela e não da API HTML; e as três saídas foram testadas uma a uma — Esc, perda de foco e fim da transmissão — verificando `isFullScreen()` do lado do processo principal, além de a janela nunca estar com "sempre por cima";
- **modo Fiore**: vem desligado, o botão fica mesmo acima do Sair, cada acontecimento dispara o som certo (entrada, saída, stream e mudo, inclusive os seus próprios), os dois áudios de stream são sorteados de verdade, quem não ligou não ouve nada, e a escolha sobrevive ao recarregar; os cinco arquivos também foram conferidos decodificando no navegador;
- **música sincronizada**, com o player real trocado por um simulado: os players carregam o mesmo vídeo, ficam a menos de 0,1s de distância um do outro, quem entra depois cai no ponto certo (e não no começo), pausar e pular valem para todos, e um player forçado a escorregar 17s voltou sozinho ao lugar na batida seguinte; a fila é zerada quando a sala esvazia;
- **som por aplicativo, de ponta a ponta**: com a captura nativa substituída por um tom de 440 Hz no mesmo formato (PCM 16 bits, estéreo, 48 kHz), o áudio percorre IPC → AudioWorklet → WebRTC e **chega no outro participante medido a 441 Hz**, em canal separado da voz; a opção some quando o sistema não a suporta, e parar de compartilhar encerra a captura junto;
- **sair da transmissão**: o quadro some, o som dela é cortado, as outras seguem normais, a barra oferece o retorno, e a aba fechada some sozinha quando a pessoa para de transmitir;
- **celular**: com o aparelho emulado de verdade (tela de telefone, toque no lugar do mouse e a API de captura de tela removida, que é a situação real do iPhone) — as barras de cima e de baixo aparecem, a lateral vira gaveta que abre no ☰ e fecha ao tocar fora, a página não sai para os lados, o botão de tela avisa "só no PC" e explica o porquê em vez de dar erro, a câmera do celular abre e **chega no PC da galera** (medido no `<video>` do outro lado), o botão "Virar" pede mesmo `facingMode: environment` (verificado espionando a chamada, já que a imagem de teste é igual dos dois lados) e o lado escolhido fica lembrado, a traseira não vem espelhada, quem assiste não perde a imagem durante a troca, o chat começa fechado e abre cobrindo a tela com contador de não lidas, o mudo do polegar aciona o botão de verdade e a sala inteira vê, o painel de música cobre a tela, deitado a barra encolhe e sobra tela para a imagem — e, no mesmo teste, o layout do **computador continua exatamente como era**;
- **arrumação dos quadros**: medida por geometria de verdade — quatro transmissões viram 2×2 com cada quadro ~80% mais largo que na fileira antiga, os quatro saem exatamente do mesmo tamanho, 70% do palco vira imagem, nada transborda (o palco não ganha barra de rolagem), num palco estreito e alto os quadros empilham em coluna, fechar o chat os faz crescer na hora, e focar num só continua esticando para o palco inteiro;
- **webcam**: a conexão carrega mesmo **quatro canais** na ordem certa (voz, som da tela, tela, câmera), a imagem chega do outro lado com frames decodificados de verdade (não só um `<video>` na tela), tela e câmera da mesma pessoa convivem em quadros separados sem se embaralhar, ligar e desligar não muda o número de canais (nada renegocia), desligar a câmera não derruba a transmissão de tela, religar volta a mandar imagem, dá para esconder só a câmera de alguém e reabrir pela barra, e quem sai leva os dois quadros junto; no app Electron a permissão de câmera passa e a prévia sai espelhada em 1280x720.

Também corrigi no caminho um defeito que só aparecia ao parar e recomeçar rápido: um evento atrasado de "faixa muda" derrubava o quadro da transmissão nova. Agora quem manda é o estado anunciado pela pessoa, e os eventos da faixa só pedem uma reavaliação.

Depois, com o app já em uso, apareceram dois defeitos que só dava para ver rodando de verdade no Windows:

**O som só saía de guias do navegador.** A captura pedia o áudio com um objeto de restrições (`echoCancellation: false` e afins). O Chromium recusa esse pedido para som de sistema, o app caía na tentativa sem áudio e compartilhava mudo — enquanto o áudio de guia, que segue outro caminho, funcionava. Agora o pedido é `audio: true`, puro. Não se perde nada: áudio de tela não passa por filtro de voz nenhum. No mesmo trecho havia um segundo defeito escondido: na tentativa sem som, a janela escolhida no diálogo já tinha sido consumida, então o app compartilhava a tela errada.

**Alt+Tab e o botão Windows travando durante e depois da transmissão.** A tela cheia usava a API do HTML; no Windows isso põe a janela do Electron cobrindo a tela inteira, inclusive a barra de tarefas, sem um caminho confiável de volta — e quando a transmissão acabava, o quadro sumia mas a janela continuava lá, cobrindo tudo. Não era o Keyboard Lock (essa API nunca liga sozinha, precisa ser chamada, e o Falatório não a chama). A tela cheia agora é da janela, controlada pelo processo principal, com três saídas garantidas: **Esc**, **perder o foco** (que é exatamente o que o Alt+Tab faz) e **o fim da transmissão**. A janela também nunca fica com "sempre por cima".

E dois defeitos de CSS que faziam a tela cheia parecer quebrada:

1. **A tela cheia abria, mas o quadro continuava pequeno.** A regra do modo foco (`.grid.focus-mode .tile`) tem especificidade maior que a de tela cheia e prendia o quadro à altura da grade. O teste antigo só verificava `document.fullscreenElement`, que estava certo — por isso passou sem pegar o problema. Agora o teste mede a geometria e exige que o quadro cubra a viewport.
2. **Elemento escorregando de linha na grade.** Quando a barra de abas some com `display: none`, ela sai da grade e o palco escorrega para a linha "auto", que encolhe. As posições agora são fixas (`grid-row`), então esconder qualquer coisa não bagunça o resto. Era o mesmo defeito que já tinha derrubado o chat uma vez.

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

Se um dia quiserem crescer: múltiplos canais de voz e texto, histórico salvo em SQLite, desfoque de fundo na câmera, ou trocar a malha por um servidor SFU (mediasoup) para aguentar dezenas de pessoas. A base já está pronta para qualquer um desses caminhos.
