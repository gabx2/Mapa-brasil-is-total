# Malha unificada de exibição

O HTML carrega os arquivos desta pasta. Cada contorno estadual é a união dos
municípios correspondentes, com as mesmas coordenadas e os mesmos arcos usados
pelos estados vizinhos. Os arquivos originais em `dados/` não são sobrescritos.

## Reconstruir

Na raiz do projeto:

```powershell
npm.cmd ci --prefix .map-tools --ignore-scripts
node scripts/build-aligned-map.cjs
node scripts/check-aligned-map.cjs
```

O gerador reúne as 27 malhas municipais antes de construir a topologia, ajusta
vértices próximos (0,0015 grau) e repara sobreposições e frestas de até 1500 m de
largura estimada. Lacunas fechadas restantes que tocam mais de uma UF são unidas
ao município com maior fronteira compartilhada. Buracos inteiramente dentro de
uma UF não entram nessa última etapa. Trata-se de harmonização para exibição
cartográfica, não de atualização dos limites administrativos originais.

A exportação não aplica uma nova quantização por estado. Isso evita que
coordenadas idênticas passem a diferir quando carregadas de arquivos separados.
`conjunto.json` guarda a topologia municipal nacional usada na geração.

O verificador confere o total de municípios, a igualdade dos contornos estaduais
com a união municipal, a orientação oposta dos arcos entre vizinhos e a ausência
de lacunas fechadas entre UFs. As imagens em `qa/` são comparações estáticas da
geometria de São Paulo e de um trecho ampliado da divisa com Minas Gerais.

Ferramenta de reparo: [Mapshaper](https://mapshaper.org/docs/reference.html#clean).
