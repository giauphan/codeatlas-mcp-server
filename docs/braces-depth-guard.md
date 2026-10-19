# Local `braces` depth-guard compatibility

`braces` currently enters the development dependency graph through
`semantic-release` and `@semantic-release/commit-analyzer`, via `micromatch`.
This compatibility patch is only needed in the development dependency graph.
The published `braces@3.0.3` parser does not bound nested brace parsing. The
repository overrides that package with the local `tools/braces-compat` adapter,
which re-exports the independently named `@dieub/braces-depth-guard` package.
The fork is stored byte-for-byte at `vendor/original-unmodified-fork.tgz` so
package managers do not need to rename it or misidentify its source.

The root dependency key and installed path are both named `braces`, while the
adapter manifest keeps its own identity as `@codeatlas/braces-compat`. This
local alias is a compatibility mechanism; the adapter is not an upstream
`braces` release. The scoped fork remains separately identified in the
dependency manifest and lockfiles.

The pinned candidate is `@dieub/braces-depth-guard@3.0.3-pn.3`, from
<https://github.com/dieub/braces-depth-guard>. It preserves the upstream
`braces` CommonJS API and adds a maximum nesting depth of 100. The upstream
MIT license and attribution are included in the archive. The fork is a
maintained derivative, not an upstream release or an advisory dismissal.

Archive SHA-256:

```text
bfddf5527888add524fb533818cd5c56ed66e9d0454705e1a4ef002de9905227
```

Before changing the pin, compare the candidate with the exact archive, review
its provenance and license, and run the braces regression tests. Once an
upstream `braces` release includes the nesting fix, verify that release and its
API, then remove the adapter, vendored archive, override, and this note as part
of adopting the upstream package.
