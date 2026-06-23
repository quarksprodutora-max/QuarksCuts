# Quarks Cuts — painel do Premiere

> Os cortes da IA (VoxFlow), direto na timeline do Premiere — na ordem certa (gancho primeiro).

Extensão CEP para o Premiere Pro que lê o `clips.json` gerado pelo VoxFlow/Quarks Cuts
e cria **uma sequência por corte** (e você também pode montar manualmente por faixas de tempo).

Fork de [Clip Assassin](https://github.com/Uhlovic/Clip_Assassin) (a parte de criar
sequências a partir de tempos vem dele); a novidade é ler o `clips.json` da IA e
**preservar a ordem** dos trechos (o Clip Assassin original ordena por tempo, o que
desfaria o gancho-primeiro do VoxFlow).

## Instalação
1. Feche o Premiere.
2. Clique com o botão direito em `INSTALL.bat` → **Executar como administrador**.
   (Ativa o PlayerDebugMode do CSXS e copia a extensão para a pasta CEP.)
3. Abra o Premiere → **Window → Extensions → Quarks Cuts**.

## Como usar (fluxo completo)
1. No **VoxFlow/Quarks Cuts** (app desktop), processe o vídeo com "Gerar Cortes". Baixe o ZIP
   e extraia o **`clips.json`** (e, se quiser importar via arquivo, o `Premiere_Timelines.xml`).
2. No **Premiere**, crie um projeto e **importe o vídeo do podcast** (o mesmo que gerou os cortes).
3. Abra o painel **Quarks Cuts** → **📂 Carregar clips.json** → selecione o arquivo.
4. Pronto: cada corte vira uma sequência **"QC - <título>"** com os trechos na ordem da IA.

> O painel usa o **primeiro clipe de vídeo** do projeto como fonte. Tenha só o vídeo certo
> importado (ou deixe-o como primeiro item).

## Alternativa: importar o XML
Se preferir não usar o painel, no Premiere use **File → Import → `Premiere_Timelines.xml`**:
ele traz a sequência mestre + uma por corte, relinkando ao vídeo original.

## Modo manual (bônus, herdado do Clip Assassin)
Cole faixas de tempo (`1m57-2m08`, `00:01:30:15-00:02:00:20`, etc.), uma por linha, e use
"RUN THE BLADES" (manter) ou "REVERSE BLADES" (apagar). Esse modo **ordena** por tempo.
