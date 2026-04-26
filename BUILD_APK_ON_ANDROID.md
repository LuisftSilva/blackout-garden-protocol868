# Gerar o APK usando apenas o telemóvel Android

Este método não compila o APK dentro do telemóvel. Usa o telemóvel apenas para enviar o projeto para o GitHub e deixar o GitHub Actions compilar o APK automaticamente. É o método mais simples sem PC.

## Passos

1. Cria um repositório novo no GitHub.
2. Faz upload de todo o conteúdo desta pasta para o repositório.
3. Abre o separador **Actions** no GitHub.
4. Escolhe **Build Android APK**.
5. Carrega em **Run workflow**.
6. Quando terminar, abre o workflow concluído.
7. Em **Artifacts**, descarrega:

```text
BlackoutGarden-Protocol868-debug-apk
```

8. Extrai o ZIP do artifact.
9. Instala o ficheiro:

```text
app-debug.apk
```

## No Android

Ao abrir o APK, o Android pode pedir permissão para instalar apps de origem desconhecida. Autoriza a app que estás a usar para abrir o ficheiro, por exemplo Chrome, Brave, Files ou Drive.

## Resultado esperado

O APK é uma app Android nativa com WebView, contendo o jogo offline em `android_asset/game/`. Não precisa de internet para jogar.
