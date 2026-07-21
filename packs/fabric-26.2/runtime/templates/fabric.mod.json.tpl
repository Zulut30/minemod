{
  "schemaVersion": 1,
  "id": "@@MCDEV_MOD_ID@@",
  "version": "${version}",
  "name": "@@MCDEV_PROJECT_NAME@@",
  "description": "Generated locally by Minecraft AI Mod Studio from an approved ModSpec.",
  "authors": [
    "@@MCDEV_PROJECT_AUTHOR@@"
  ],
  "license": "@@MCDEV_PROJECT_LICENSE@@",
  "environment": "*",
  "entrypoints": {
    "main": [
      "@@MCDEV_MAIN_CLASS@@"
    ],
    "client": [
      "@@MCDEV_CLIENT_CLASS@@"
    ]
  },
  "depends": {
    "fabricloader": ">=0.19.3",
    "minecraft": "~26.2",
    "java": ">=25",
    "fabric-api": "*"
  }
}
