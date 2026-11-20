# Paid Stellar RPC providers

Concord's default mainnet endpoints are free public ones, which suit light use. For anything
more (many assets, a short sync interval, several workspaces) point
`CONCORD_MAINNET_RPC_URLS` at a provider. This page walks through the two ways providers take
an API key, how to list several endpoints for failover, what history to expect, and how to check
the result. The full variable reference is [`CONFIGURATION.md`](./CONFIGURATION.md).

Every example below uses placeholder hosts and keys. Replace them with your provider's.

## 1. Find out how your provider takes the key

Provider dashboards show one of two shapes:

| Shape | Looks like | Where Concord needs it |
| --- | --- | --- |
| **Key in the URL path** | `https://rpc.provider.example/v1/YOUR_KEY` | In `CONCORD_MAINNET_RPC_URLS`, as is |
| **Key in a header** | `https://rpc.provider.example` plus `x-api-key: YOUR_KEY` (or `Authorization: Bearer YOUR_KEY`) | Header in `CONCORD_RPC_HEADERS`, bare URL in `CONCORD_MAINNET_RPC_URLS` |

### Key in the URL path

Put the whole URL, key included, in the list:

```sh
CONCORD_MAINNET_RPC_URLS=https://rpc.provider.example/v1/YOUR_KEY
```

Concord's errors name an endpoint by host and a short reason only, so the path (and the key)
does not appear in them. Still treat the value as a secret: set it in your host's secret store,
not in a committed file.

Credentials of the form `https://user:password@host` are **rejected** at start-up. Node's
`fetch` does not support them. Move them into a header instead (below).

### Key in a header

Keep the URL bare and describe the header in `CONCORD_RPC_HEADERS`, a JSON object of
`{"<host>": {"<header name>": "<value>"}}`:

```sh
CONCORD_MAINNET_RPC_URLS=https://rpc.provider.example
CONCORD_RPC_HEADERS='{"rpc.provider.example":{"x-api-key":"YOUR_KEY"}}'
```

Bearer-token providers work the same way:

```sh
CONCORD_RPC_HEADERS='{"rpc.provider.example":{"Authorization":"Bearer YOUR_TOKEN"}}'
```

The headers are added to every request sent to that host, RPC and Horizon alike, on both
networks. Use `https://` endpoints only: headers are matched by host, so an `http://` URL for
the same host would send the key unencrypted.

#### Host keys: host or host:port

The JSON key is the endpoint URL's **host**, not the full URL. No scheme, no path.

| Endpoint URL | Key to use |
| --- | --- |
| `https://rpc.provider.example/v1` | `rpc.provider.example` |
| `https://rpc.provider.example:8443/v1` | `rpc.provider.example:8443` |

The port counts only when it is not the default for the scheme (443 for `https`). A key that
matches no endpoint is silently unused and the endpoint is called without a key, which shows up
as `HTTP 401` / "bad API key" in Concord's error.

> **Header-key workaround.** If a provider key is ignored and you get `bad API key` even though
> the JSON is valid, the host key is not matching the endpoint. Until you have confirmed the
> match, list the key under **both spellings**, with and without the port:
>
> ```sh
> CONCORD_RPC_HEADERS='{
>   "rpc.provider.example:8443": {"x-api-key": "YOUR_KEY"},
>   "rpc.provider.example":      {"x-api-key": "YOUR_KEY"}
> }'
> ```
>
> When both are present the exact `host:port` entry wins, and the bare hostname is the
> fallback. For a default-port endpoint, use the bare hostname only. Never put the scheme or a
> path in the key.

Only the outer JSON is validated at start-up; header names and values are not. A typo in a
header name is therefore not reported until the provider answers `401`/`403`.

## 2. List several endpoints for failover

`CONCORD_MAINNET_RPC_URLS` is comma-separated and tried **in order**. An endpoint that fails or
is rate limited is rested (30 seconds, or what its `Retry-After` asks for, between 1 and 60
seconds) and the next one is used. Put your primary provider first and a second, independent
one after it:

```sh
CONCORD_MAINNET_RPC_URLS=https://rpc.primary.example/v1/YOUR_KEY,https://rpc.backup.example
CONCORD_RPC_HEADERS='{"rpc.backup.example":{"x-api-key":"YOUR_BACKUP_KEY"}}'
```

Notes:

- Mix key styles freely: the first entry above carries its key in the path, the second in a
  header.
- Choose providers that run separate infrastructure. Two plans on one provider fail together.
- Leaving one of the free public endpoints as the last entry is a reasonable last resort. The
  free endpoints are the defaults only when the list is empty.
- Testnet has its own lists: `CONCORD_TESTNET_RPC_URLS`, and the `*_HORIZON_URLS` variables for
  Horizon. The same `CONCORD_RPC_HEADERS` applies to all of them.

## 3. Sensible limits to expect

- **History is about seven days.** Stellar RPC keeps roughly a week of events, whichever
  provider you use, and a few providers keep less. Concord therefore starts a classic asset
  from opening balances and reads events from there. If the indexer is down for longer than the
  provider's retention, the events in between are lost: see [`limits.md`](./limits.md) and
  [`history-and-baselines.md`](./history-and-baselines.md). Check the retention your plan
  promises before relying on it for recovery.
- **Request rate.** The background indexer makes a pass every `CONCORD_SYNC_INTERVAL` seconds
  (default 30). Each pass makes a few RPC calls per watched asset, so a smaller interval or
  more assets means more requests. A plan that returns `429` is not fatal, because Concord rests
  that endpoint and moves on, but if every endpoint is limited, syncing stalls. Raise the
  interval or the plan before adding assets.
- **Dashboard traffic is separate.** Dashboard pages read Concord's own database, not the
  provider, so more viewers do not mean more RPC calls.

Start with the provider's smallest paid plan and watch the error messages in
[`troubleshooting.md`](./troubleshooting.md): repeated `rate limited` means the plan is too small.

## 4. Check the endpoint with `getHealth`

Before putting an endpoint in Concord, call it directly. With the key in the path:

```sh
curl -s -X POST https://rpc.provider.example/v1/YOUR_KEY \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

With the key in a header:

```sh
curl -s -X POST https://rpc.provider.example \
  -H 'content-type: application/json' \
  -H 'x-api-key: YOUR_KEY' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'
```

A good answer looks like this (numbers will differ):

```json
{"jsonrpc":"2.0","id":1,"result":{"status":"healthy","latestLedger":60000000,"oldestLedger":59950000,"ledgerRetentionWindow":17280}}
```

- `status` is `healthy`.
- `latestLedger - oldestLedger` is your **retention**. A ledger closes about every 5 seconds,
  so 17,280 ledgers is about one day and about 120,960 is the seven days Concord expects. A much
  smaller window means a shorter recovery margin after downtime.
- `401`/`403` means the key is wrong or is being sent the wrong way for that provider.

Then start Concord. It calls `getHealth` itself to learn the ledger range; if the endpoint
cannot be used, the error names each endpoint by host and a short reason (`HTTP 401`,
`rate limited`, `timed out`, `unreachable`) without showing keys or URL paths.

## See also

- [`CONFIGURATION.md`](./CONFIGURATION.md): every variable, and the security notes for
  `CONCORD_RPC_HEADERS`.
- [`troubleshooting.md`](./troubleshooting.md): sync and indexing messages.
- Deploy runbooks that set these variables: [`deploy/fly.md`](./deploy/fly.md),
  [`deploy/docker-compose.md`](./deploy/docker-compose.md), [`deploy/systemd.md`](./deploy/systemd.md).
