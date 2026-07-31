# manage-solar-seller

Función privada para que un administrador del portal solar cree vendedores,
actualice su comisión, suspenda su acceso o reemplace su contraseña temporal.

Requiere un JWT autenticado en `Authorization: Bearer ...`. La función verifica
que el usuario tenga un perfil activo con rol `admin` antes de utilizar
`SUPABASE_SERVICE_ROLE_KEY`.

Despliegue:

```bash
supabase functions deploy manage-solar-seller
```
