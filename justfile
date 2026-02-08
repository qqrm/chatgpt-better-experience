set shell := ["bash", "-cu"]

run-readme-screenshot-pipeline force="false":
    gh workflow run update-readme-dark-screenshot.yml -f force_update={{force}}
