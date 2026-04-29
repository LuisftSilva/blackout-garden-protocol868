# Blackout Garden: Protocol 868 — Asset Production Spec v1

## Objetivo

Versão 0.2.0-production-art: integrar assets de produção no jogo Android/WebView.

## Assets incluídos

| Asset | Ficheiro | Uso |
|---|---|---|
| Base bunker | base_bunker_prod.webp | ecrã da base |
| Battlefield | battlefield_prod.webp | fundo de missão |
| Player | player_prod.webp | sprite do jogador |
| Raider | raider_prod.webp | inimigo humano/crawler temporário |
| Drone | drone_prod.webp | inimigo drone |
| Turret | turret_prod.webp | inimigo turret |
| HUD pack | hud_pack_prod.webp | referência visual/UI |

## Especificação visual

- Base: side-view cutaway, landscape 16:9.
- Missão: top-down / slight 3/4 tactical view.
- Player e inimigos: sprites isolados, usados em canvas.
- HUD: estilo industrial sci-fi com verde/ciano/âmbar.
- Idioma: português de Portugal.

## Próximo passo técnico

1. Separar sprite sheets reais para animação do jogador.
2. Separar HUD em peças individuais.
3. Criar mapa JSON com colisões e posições de cover.
4. Gerar inimigo crawler dedicado.
5. Adicionar VFX de tiros, impactos e explosões com sprite sheets.
