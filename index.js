==> Downloading cache...
==> Cloning from https://github.com/soratotaiyonakayoshi-cloud/Minadeanki
==> Checking out commit 9dbca21bb1a466cd87210c14bb0fa620c230775d in branch main
==> Downloaded 13MB in 1s. Extraction took 0s.
==> Using Node.js version 24.14.1 (default)
==> Docs on specifying a Node.js version: https://render.com/docs/node-version
==> Running build command 'npm install'...
added 149 packages, and audited 150 packages in 2s
27 packages are looking for funding
  run `npm fund` for details
found 0 vulnerabilities
==> Uploading build...
==> Uploaded in 2.1s. Compression took 0.9s
==> Build successful 🎉
==> Deploying...
==> Setting WEB_CONCURRENCY=1 by default, based on available CPUs in the instance
==> Running 'node index.js'
/opt/render/project/src/index.js:205
      let qImg = row['画像URL'] ? \`<a href="\${row['画像URL']}" target="_blank"><img src="\${row['画像URL']}" class="table-image" alt="画像"></a>\` : '-';
                                ^
SyntaxError: Invalid or unexpected token
    at wrapSafe (node:internal/modules/cjs/loader:1743:18)
    at Module._compile (node:internal/modules/cjs/loader:1786:20)
    at Object..js (node:internal/modules/cjs/loader:1943:10)
    at Module.load (node:internal/modules/cjs/loader:1533:32)
    at Module._load (node:internal/modules/cjs/loader:1335:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47
Node.js v24.14.1
==> Exited with status 1
==> Common ways to troubleshoot your deploy: https://render.com/docs/troubleshooting-deploys
==> Running 'node index.js'
/opt/render/project/src/index.js:205
      let qImg = row['画像URL'] ? \`<a href="\${row['画像URL']}" target="_blank"><img src="\${row['画像URL']}" class="table-image" alt="画像"></a>\` : '-';
                                ^
SyntaxError: Invalid or unexpected token
    at wrapSafe (node:internal/modules/cjs/loader:1743:18)
    at Module._compile (node:internal/modules/cjs/loader:1786:20)
    at Object..js (node:internal/modules/cjs/loader:1943:10)
    at Module.load (node:internal/modules/cjs/loader:1533:32)
    at Module._load (node:internal/modules/cjs/loader:1335:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47
Node.js v24.14.1
