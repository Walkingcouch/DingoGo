/**
 * Database security for a hosted Postgres (Supabase): run after migrations by `db:bootstrap` and AUTO_MIGRATE.
 *
 * - Row Level Security on every table in `public`. The API connects as the tables' owner (or a role with a policy below), so
 *   nothing changes for it; anyone else reaching the tables (Supabase's REST API with the anon key) sees nothing.
 * - Supabase's `anon` and `authenticated` roles lose every privilege on `public` (tables, sequences, functions) and on tables
 *   created later. DingoGo never uses Supabase's REST API or client keys.
 * - Optional least-privilege API role (DB_API_ROLE + DB_API_ROLE_PASSWORD): may read and write rows, may not change the schema.
 *   Then point DATABASE_URL at that role and MIGRATION_DATABASE_URL at the owner.
 *
 * Idempotent and cheap to re-run: tables that already have RLS are left alone (no table locks taken), policies are created once.
 */
import type pg from 'pg';

type Queryable = Pick<pg.PoolClient, 'query'>;
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const ident = (s: string) => '"' + s.replace(/"/g, '""') + '"';
const literal = (s: string) => "'" + s.replace(/'/g, "''") + "'";

export interface SecurityOptions {
  apiRole?: string;
  apiRolePassword?: string;
  /** Turn RLS on (default true). */
  rls?: boolean;
}
export interface SecurityResult {
  rls_enabled: string[];
  rls_skipped: { table: string; reason: string }[];
  locked_roles: string[];
  api_role: string | null;
  policies_created: number;
}

export async function applyDbSecurity(c: Queryable, opts: SecurityOptions = {}): Promise<SecurityResult> {
  const out: SecurityResult = { rls_enabled: [], rls_skipped: [], locked_roles: [], api_role: null, policies_created: 0 };
  const me = (await c.query(`SELECT current_user AS u, rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`)).rows[0];

  // 1. Optional API role with row access only.
  let apiRole: string | null = null;
  if (opts.apiRole) {
    if (!ROLE.test(opts.apiRole)) throw new Error(`DB_API_ROLE "${opts.apiRole}" is not a valid role name (lower-case letters, digits, _)`);
    apiRole = opts.apiRole;
    const exists = (await c.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [apiRole])).rowCount;
    if (!exists) {
      if (!opts.apiRolePassword) throw new Error(`Role ${apiRole} doesn't exist: set DB_API_ROLE_PASSWORD to create it`);
      await c.query(`CREATE ROLE ${ident(apiRole)} LOGIN PASSWORD ${literal(opts.apiRolePassword)}`);
    } else if (opts.apiRolePassword) {
      await c.query(`ALTER ROLE ${ident(apiRole)} LOGIN PASSWORD ${literal(opts.apiRolePassword)}`);
    }
    await c.query(`GRANT USAGE ON SCHEMA public TO ${ident(apiRole)}`);
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ident(apiRole)}`);
    await c.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${ident(apiRole)}`);
    await c.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${ident(apiRole)}`);
    // Tables the owner creates in later migrations.
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(apiRole)}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${ident(apiRole)}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${ident(apiRole)}`);
    out.api_role = apiRole;
  }

  // 2. Supabase's client roles: no access to anything in public, now or later.
  const clientRoles = (await c.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated') ORDER BY rolname`)).rows.map((r) => r.rolname as string);
  for (const r of clientRoles) {
    await c.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${ident(r)}`);
    await c.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${ident(r)}`);
    await c.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${ident(r)}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${ident(r)}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${ident(r)}`);
    await c.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM ${ident(r)}`);
    out.locked_roles.push(r);
  }

  if (opts.rls === false) return out;

  // 3. Policies first (so a non-owner API role never loses access), then RLS on tables that don't have it yet.
  //    The connecting role needs a policy only if it isn't a superuser / BYPASSRLS and doesn't own the table.
  const tables = (await c.query(
    `SELECT c.relname AS t, c.relrowsecurity AS rls, pg_get_userbyid(c.relowner) AS owner
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname`)).rows as { t: string; rls: boolean; owner: string }[];
  const policyRoles = [...new Set([apiRole].filter(Boolean) as string[])];
  for (const { t, rls, owner } of tables) {
    const roles = [...policyRoles, ...(!me.bypass && owner !== me.u ? [me.u] : [])];
    try {
      for (const r of roles) {
        const name = `dingogo_${r}_rw`.slice(0, 63);
        const has = (await c.query(`SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 AND policyname = $2`, [t, name])).rowCount;
        if (has) continue;
        await c.query(`CREATE POLICY ${ident(name)} ON public.${ident(t)} FOR ALL TO ${ident(r)} USING (true) WITH CHECK (true)`);
        out.policies_created++;
      }
      if (!rls) {
        await c.query(`ALTER TABLE public.${ident(t)} ENABLE ROW LEVEL SECURITY`);
        out.rls_enabled.push(t);
      }
    } catch (e: any) {
      out.rls_skipped.push({ table: t, reason: String(e?.message ?? e).slice(0, 200) });
    }
  }
  return out;
}

/** For health checks: tables in public without RLS, and whether Supabase's client roles can still read any table. */
export async function securityStatus(c: Queryable) {
  const noRls = (await c.query(
    `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity ORDER BY 1`)).rows.map((r) => r.t as string);
  const exposed = (await c.query(
    `SELECT DISTINCT grantee || ':' || table_name AS x FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated') ORDER BY 1 LIMIT 20`)).rows.map((r) => r.x as string);
  return { tables_without_rls: noRls, client_role_grants: exposed };
}
