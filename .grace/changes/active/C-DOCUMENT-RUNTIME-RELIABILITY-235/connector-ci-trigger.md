# Exact-head connector verification trigger

Этот файл создан GitHub write connector после завершения делегированных scopes. Его назначение — сформировать новый exact head, на котором GitHub обязан заново выполнить полный PR CI, включая GRACE, проектные, browser, offline, release и database gates.

Файл не является доказательством успешности сам по себе. Merge разрешён только по фактическим результатам checks именно этого head SHA.
