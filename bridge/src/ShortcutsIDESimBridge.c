#include <ctype.h>
#include <dlfcn.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/time.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

#define BRIDGE_VERSION "sim-0.1.28-shortpy-runtime-pipeline"
#define SOCKET_NAME "shortcuts-ide-bridge-sim.sock"
#define DEFAULT_SOCKET_PATH "/tmp/" SOCKET_NAME
#define DEFAULT_LOG_PATH "/tmp/shortcuts-ide-bridge-sim.log"

#define MAX_COMMAND (24 * 1024 * 1024)
#define MAX_RESPONSE (16 * 1024 * 1024)
#define MAX_SOURCE (2 * 1024 * 1024)
#define MAX_PLIST_BYTES (16 * 1024 * 1024)
#define MAX_TEXT 32768

// Disabled after validation: global filesystem interposition made WorkflowKit
// CoreData startup unstable. Keep the proven missing asset path in LLDB logs and
// prefer a narrower ShortcutAgent renderer path over process-wide open/stat
// hooks.
#define SHORTCUTS_GENERATOR_ASSET_PREFIX                                      \
  "/System/Library/AssetsV2/"                                                 \
  "com_apple_MobileAsset_UAF_Shortcuts_Generator/"
#define SHORTCUTS_GENERATOR_IOS_EMBEDDINGS                                    \
  "AssetData/BinaryEmbeddings_iOS.bin"
#define SHORTCUTS_GENERATOR_MACOS_EMBEDDINGS                                  \
  "AssetData/BinaryEmbeddings_macOS.bin"
#define SHORTCUTS_GENERATOR_METADATA_ALIAS                                     \
  "AssetData/toolEmbeddingDatabaseMetadata.json"
#define SHORTCUTS_GENERATOR_METADATA                                           \
  "AssetData/toolEmbeddingDatabase.json"

extern char *bridge_swift_pipeline_python_to_bplist(const char *source,
                                                     uint64_t flags,
                                                     uint64_t pipeline);
extern char *bridge_swift_pipeline_python_to_bplist_with_catalog_metadata(
    const char *source, const char *catalog_metadata, uint64_t flags,
    uint64_t pipeline);
extern char *bridge_swift_pipeline_plist_to_python(const char *plist_json,
                                                    uint64_t pipeline);
extern char *bridge_swift_pipeline_bplist_to_python(const uint8_t *bytes,
                                                     size_t len,
                                                     uint64_t pipeline);
extern char *bridge_swift_catalog_dump_latest(void);
extern char *bridge_swift_catalog_encode_latest_debug(void);
extern char *bridge_swift_expand_inline_catalog_metadata(
    const char *request_json);
extern char *bridge_swift_toolrenderer_python_interface(void);
extern char *bridge_swift_toolrenderer_structured_metadata(void);

typedef struct {
  pthread_mutex_t lock;
  bool socket_ready;
  char socket_path[PATH_MAX];
  char log_path[PATH_MAX];
  uint64_t command_count;
  char pending_source[MAX_TEXT];
  size_t pending_source_len;
  uint64_t pending_generation;
  char last_event[MAX_TEXT];
  char last_source[MAX_TEXT];
  char last_response[MAX_TEXT];
  char last_diagnostic[MAX_TEXT];
} BridgeState;

static BridgeState g_state = {
    .lock = PTHREAD_MUTEX_INITIALIZER,
    .socket_path = "",
    .log_path = DEFAULT_LOG_PATH,
};

#if 0
static bool has_suffix(const char *value, const char *suffix) {
  if (!value || !suffix) {
    return false;
  }
  size_t value_len = strlen(value);
  size_t suffix_len = strlen(suffix);
  return value_len >= suffix_len &&
         memcmp(value + value_len - suffix_len, suffix, suffix_len) == 0;
}

static const char *mapped_asset_path(const char *path, char *buffer,
                                     size_t buffer_size) {
  if (!path || strncmp(path, SHORTCUTS_GENERATOR_ASSET_PREFIX,
                       strlen(SHORTCUTS_GENERATOR_ASSET_PREFIX)) != 0) {
    return path;
  }

  const char *from_suffix = NULL;
  const char *to_suffix = NULL;
  if (has_suffix(path, SHORTCUTS_GENERATOR_IOS_EMBEDDINGS)) {
    from_suffix = SHORTCUTS_GENERATOR_IOS_EMBEDDINGS;
    to_suffix = SHORTCUTS_GENERATOR_MACOS_EMBEDDINGS;
  } else if (has_suffix(path, SHORTCUTS_GENERATOR_METADATA_ALIAS)) {
    from_suffix = SHORTCUTS_GENERATOR_METADATA_ALIAS;
    to_suffix = SHORTCUTS_GENERATOR_METADATA;
  } else {
    return path;
  }

  size_t path_len = strlen(path);
  size_t from_len = strlen(from_suffix);
  size_t prefix_len = path_len - from_len;
  int wrote = snprintf(buffer, buffer_size, "%.*s%s", (int)prefix_len, path,
                       to_suffix);
  if (wrote < 0 || (size_t)wrote >= buffer_size) {
    return path;
  }
  return buffer;
}

static int bridge_open(const char *path, int flags, ...) {
  mode_t mode = 0;
  bool has_mode = (flags & O_CREAT) != 0;
  if (has_mode) {
    va_list ap;
    va_start(ap, flags);
    mode = (mode_t)va_arg(ap, int);
    va_end(ap);
  }

  char mapped[PATH_MAX];
  const char *effective_path = mapped_asset_path(path, mapped, sizeof(mapped));
  if (has_mode) {
    return (int)syscall(SYS_open, effective_path, flags, mode);
  }
  return (int)syscall(SYS_open, effective_path, flags, 0);
}

static int bridge_openat(int fd, const char *path, int flags, ...) {
  mode_t mode = 0;
  bool has_mode = (flags & O_CREAT) != 0;
  if (has_mode) {
    va_list ap;
    va_start(ap, flags);
    mode = (mode_t)va_arg(ap, int);
    va_end(ap);
  }

  char mapped[PATH_MAX];
  const char *effective_path = mapped_asset_path(path, mapped, sizeof(mapped));
  if (has_mode) {
    return (int)syscall(SYS_openat, fd, effective_path, flags, mode);
  }
  return (int)syscall(SYS_openat, fd, effective_path, flags, 0);
}

static int bridge_access(const char *path, int mode) {
  char mapped[PATH_MAX];
  return (int)syscall(SYS_access, mapped_asset_path(path, mapped, sizeof(mapped)),
                      mode);
}

static int bridge_stat(const char *path, struct stat *buf) {
  char mapped[PATH_MAX];
  return (int)syscall(SYS_stat, mapped_asset_path(path, mapped, sizeof(mapped)),
                      buf);
}

static int bridge_lstat(const char *path, struct stat *buf) {
  char mapped[PATH_MAX];
  return (int)syscall(SYS_lstat, mapped_asset_path(path, mapped, sizeof(mapped)),
                      buf);
}

static FILE *bridge_fopen(const char *path, const char *mode) {
  int flags = O_RDONLY;
  if (mode && mode[0] == 'w') {
    flags = O_WRONLY | O_CREAT | O_TRUNC;
  } else if (mode && mode[0] == 'a') {
    flags = O_WRONLY | O_CREAT | O_APPEND;
  } else if (mode && strchr(mode, '+')) {
    flags = O_RDWR;
  }
  char mapped[PATH_MAX];
  int fd = (int)syscall(SYS_open, mapped_asset_path(path, mapped, sizeof(mapped)),
                        flags, 0666);
  if (fd < 0) {
    return NULL;
  }
  FILE *file = fdopen(fd, mode);
  if (!file) {
    close(fd);
  }
  return file;
}

struct dyld_interpose_tuple {
  const void *replacement;
  const void *replacee;
};

__attribute__((used)) static const struct dyld_interpose_tuple
    bridge_interposers[] __attribute__((section("__DATA,__interpose"))) = {
        {(const void *)bridge_open, (const void *)open},
        {(const void *)bridge_openat, (const void *)openat},
        {(const void *)bridge_access, (const void *)access},
        {(const void *)bridge_stat, (const void *)stat},
        {(const void *)bridge_lstat, (const void *)lstat},
        {(const void *)bridge_fopen, (const void *)fopen},
};
#endif

static void json_escape(const char *in, char *out, size_t cap) {
  if (cap == 0) {
    return;
  }
  size_t pos = 0;
  for (const unsigned char *p = (const unsigned char *)(in ? in : ""); *p;
       p++) {
    if (pos + 8 >= cap) {
      break;
    }
    switch (*p) {
    case '\\':
      out[pos++] = '\\';
      out[pos++] = '\\';
      break;
    case '"':
      out[pos++] = '\\';
      out[pos++] = '"';
      break;
    case '\n':
      out[pos++] = '\\';
      out[pos++] = 'n';
      break;
    case '\r':
      out[pos++] = '\\';
      out[pos++] = 'r';
      break;
    case '\t':
      out[pos++] = '\\';
      out[pos++] = 't';
      break;
    default:
      if (*p < 0x20) {
        int wrote = snprintf(out + pos, cap - pos, "\\u%04x", *p);
        if (wrote < 0) {
          out[pos] = 0;
          return;
        }
        pos += (size_t)wrote;
      } else {
        out[pos++] = (char)*p;
      }
      break;
    }
  }
  out[pos] = 0;
}

static void set_last_event_locked(const char *event, const char *detail) {
  snprintf(g_state.last_event, sizeof(g_state.last_event), "%s%s%s",
           event ? event : "", detail && detail[0] ? ": " : "",
           detail ? detail : "");
}

static void append_log(const char *fmt, ...) {
  char path[PATH_MAX];
  pthread_mutex_lock(&g_state.lock);
  strlcpy(path, g_state.log_path[0] ? g_state.log_path : DEFAULT_LOG_PATH,
          sizeof(path));
  pthread_mutex_unlock(&g_state.lock);

  FILE *f = fopen(path, "a");
  if (!f) {
    return;
  }
  time_t now = time(NULL);
  struct tm tmv;
  localtime_r(&now, &tmv);
  char ts[64];
  strftime(ts, sizeof(ts), "%Y-%m-%d %H:%M:%S", &tmv);
  fprintf(f, "[%s] ", ts);
  va_list ap;
  va_start(ap, fmt);
  vfprintf(f, fmt, ap);
  va_end(ap);
  fprintf(f, "\n");
  fclose(f);
}

static int b64_value(char c) {
  if (c >= 'A' && c <= 'Z') {
    return c - 'A';
  }
  if (c >= 'a' && c <= 'z') {
    return c - 'a' + 26;
  }
  if (c >= '0' && c <= '9') {
    return c - '0' + 52;
  }
  if (c == '+') {
    return 62;
  }
  if (c == '/') {
    return 63;
  }
  if (c == '=') {
    return -2;
  }
  return -1;
}

static ssize_t decode_base64(const char *in, uint8_t *out, size_t cap) {
  uint32_t accum = 0;
  int bits = 0;
  size_t pos = 0;
  for (const char *p = in ? in : ""; *p; p++) {
    if (isspace((unsigned char)*p)) {
      continue;
    }
    int v = b64_value(*p);
    if (v == -2) {
      break;
    }
    if (v < 0) {
      return -1;
    }
    accum = (accum << 6) | (uint32_t)v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (pos >= cap) {
        return -1;
      }
      out[pos++] = (uint8_t)((accum >> bits) & 0xff);
    }
  }
  return (ssize_t)pos;
}

static bool direct_result_has_diagnostic(const char *result) {
  return result &&
         (strstr(result, "\"ok\":false") || strstr(result, "\"diagnostic\"") ||
          strstr(result, "\"error_policy_decision_count\":") ||
          strstr(result, "\"error_policy_decisions\""));
}

static void remember_result(const char *event, const char *source_prefix,
                            const char *source, size_t source_len,
                            const char *result) {
  pthread_mutex_lock(&g_state.lock);
  g_state.command_count++;
  snprintf(g_state.last_source, sizeof(g_state.last_source),
           "%s length=%zu\n%s", source_prefix ? source_prefix : "command",
           source_len, source ? source : "");
  snprintf(g_state.last_response, sizeof(g_state.last_response), "%s",
           result ? result : "");
  if (direct_result_has_diagnostic(result)) {
    snprintf(g_state.last_diagnostic, sizeof(g_state.last_diagnostic), "%s",
             result ? result : "");
  } else {
    g_state.last_diagnostic[0] = 0;
  }
  set_last_event_locked(event, result ? result : "");
  pthread_mutex_unlock(&g_state.lock);
}

static void status_json(char *response, size_t cap) {
  pthread_mutex_lock(&g_state.lock);
  char socket_escaped[PATH_MAX * 2];
  char log_escaped[PATH_MAX * 2];
  char event_escaped[MAX_TEXT];
  json_escape(g_state.socket_path[0] ? g_state.socket_path : DEFAULT_SOCKET_PATH,
              socket_escaped, sizeof(socket_escaped));
  json_escape(g_state.log_path[0] ? g_state.log_path : DEFAULT_LOG_PATH,
              log_escaped, sizeof(log_escaped));
  json_escape(g_state.last_event, event_escaped, sizeof(event_escaped));
  snprintf(response, cap,
           "{\"ok\":true,"
           "\"version\":\"%s\","
           "\"target\":\"ios-simulator-27.0\","
           "\"pid\":%d,"
           "\"architecture\":\"single-dylib-name-resolved\","
           "\"socket_ready\":%s,"
           "\"socket_path\":\"%s\","
           "\"log_path\":\"%s\","
           "\"swift_linkage\":\"direct cdecl exports in same dylib\","
           "\"visibility_source\":\"active-toolkit-sqlite\","
           "\"tool_visibility_filter\":\"any\","
           "\"address_resolution\":\"none\","
           "\"hooks_installed\":false,"
           "\"command_count\":%llu,"
           "\"pending_source_length\":%zu,"
           "\"pending_generation\":%llu,"
           "\"last_event\":\"%s\","
           "\"commands\":[\"status\",\"last\",\"clear\",\"set-source-b64\","
           "\"pipeline-python-to-bplist-b64-flags\","
           "\"pipeline-python-to-bplist-catalog-b64-flags\","
           "\"pipeline-plist-to-python-b64\","
           "\"pipeline-plist-data-to-python-b64\","
           "\"catalog-dump-latest\","
           "\"catalog-encode-latest-debug\","
           "\"expand-inline-catalog-b64\","
           "\"toolrenderer-python-interface\","
           "\"toolrenderer-structured-metadata\"]}",
           BRIDGE_VERSION, getpid(), g_state.socket_ready ? "true" : "false",
           socket_escaped, log_escaped,
           (unsigned long long)g_state.command_count,
           g_state.pending_source_len,
           (unsigned long long)g_state.pending_generation, event_escaped);
  pthread_mutex_unlock(&g_state.lock);
}

static void last_json(char *response, size_t cap) {
  pthread_mutex_lock(&g_state.lock);
  char event_escaped[MAX_TEXT];
  char source_escaped[MAX_TEXT];
  char response_escaped[MAX_TEXT];
  char diagnostic_escaped[MAX_TEXT];
  json_escape(g_state.last_event, event_escaped, sizeof(event_escaped));
  json_escape(g_state.last_source, source_escaped, sizeof(source_escaped));
  json_escape(g_state.last_response, response_escaped,
              sizeof(response_escaped));
  json_escape(g_state.last_diagnostic, diagnostic_escaped,
              sizeof(diagnostic_escaped));
  snprintf(response, cap,
           "{\"ok\":true,\"last_event\":\"%s\",\"last_source\":\"%s\","
           "\"last_response\":\"%s\",\"last_diagnostic\":\"%s\"}",
           event_escaped, source_escaped, response_escaped, diagnostic_escaped);
  pthread_mutex_unlock(&g_state.lock);
}

static void handle_pipeline_source_command(
    const char *event, const char *payload, uint64_t flags, uint64_t pipeline,
    char *response, size_t cap,
    char *(*runner)(const char *, uint64_t, uint64_t)) {
  uint8_t *decoded = calloc(1, MAX_SOURCE + 1);
  if (!decoded) {
    snprintf(response, cap,
             "{\"ok\":false,\"error\":\"failed to allocate source buffer\"}");
    return;
  }
  ssize_t n = decode_base64(payload, decoded, MAX_SOURCE);
  if (n < 0) {
    free(decoded);
    snprintf(response, cap,
             "{\"ok\":false,\"error\":\"invalid base64 or source too large\"}");
    return;
  }
  decoded[n] = 0;
  char *result = runner((const char *)decoded, flags, pipeline);
  if (!result) {
    free(decoded);
    snprintf(response, cap,
             "{\"ok\":false,\"error\":\"%s runner returned null\"}", event);
    return;
  }
  char source_prefix[128];
  snprintf(source_prefix, sizeof(source_prefix),
           "%s pipeline=%llu flags=%llu", event,
           (unsigned long long)pipeline, (unsigned long long)flags);
  remember_result(event, source_prefix, (const char *)decoded, (size_t)n,
                  result);
  append_log("%s pipeline=%llu flags=%llu length=%zd", event,
             (unsigned long long)pipeline, (unsigned long long)flags, n);
  strlcpy(response, result, cap);
  free(result);
  free(decoded);
}

static void handle_pipeline_catalog_command(const char *sourcePayload,
                                            const char *catalogPayload,
                                            uint64_t flags,
                                            uint64_t pipeline, char *response,
                                            size_t cap) {
  uint8_t *source = calloc(1, MAX_SOURCE + 1);
  uint8_t *catalog = calloc(1, MAX_PLIST_BYTES + 1);
  if (!source || !catalog) {
    free(source);
    free(catalog);
    snprintf(response, cap,
             "{\"ok\":false,\"error\":\"failed to allocate catalog compile buffers\"}");
    return;
  }
  ssize_t sourceLength = decode_base64(sourcePayload, source, MAX_SOURCE);
  ssize_t catalogLength =
      decode_base64(catalogPayload, catalog, MAX_PLIST_BYTES);
  if (sourceLength < 0 || catalogLength < 0) {
    free(source);
    free(catalog);
    snprintf(response, cap,
             "{\"ok\":false,\"error\":\"invalid catalog compile base64\"}");
    return;
  }
  source[sourceLength] = 0;
  catalog[catalogLength] = 0;
  char *result = bridge_swift_pipeline_python_to_bplist_with_catalog_metadata(
      (const char *)source, (const char *)catalog, flags, pipeline);
  if (!result) {
    free(source);
    free(catalog);
    snprintf(response, cap,
             "{\"ok\":false,\"error\":\"pipeline catalog compiler returned null\"}");
    return;
  }
  remember_result("pipeline_python_to_bplist_catalog",
                  "pipeline_python_to_bplist_catalog", (const char *)source,
                  (size_t)sourceLength, result);
  strlcpy(response, result, cap);
  free(result);
  free(source);
  free(catalog);
}

static void handle_command(const char *cmd, char *response, size_t cap) {
  if (strncmp(cmd, "status", 6) == 0) {
    status_json(response, cap);
    return;
  }
  if (strncmp(cmd, "last", 4) == 0) {
    last_json(response, cap);
    return;
  }
  if (strncmp(cmd, "clear", 5) == 0) {
    pthread_mutex_lock(&g_state.lock);
    g_state.pending_source[0] = 0;
    g_state.pending_source_len = 0;
    g_state.last_source[0] = 0;
    g_state.last_response[0] = 0;
    g_state.last_diagnostic[0] = 0;
    set_last_event_locked("clear", "cleared pending source and last captures");
    pthread_mutex_unlock(&g_state.lock);
    snprintf(response, cap, "{\"ok\":true,\"cleared\":true}");
    return;
  }
  if (strncmp(cmd, "set-source-b64 ", 15) == 0) {
    const char *payload = cmd + 15;
    uint8_t decoded[MAX_TEXT];
    ssize_t n = decode_base64(payload, decoded, sizeof(decoded) - 1);
    if (n < 0) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid base64 or source too large\"}");
      return;
    }
    decoded[n] = 0;
    pthread_mutex_lock(&g_state.lock);
    memcpy(g_state.pending_source, decoded, (size_t)n + 1);
    g_state.pending_source_len = (size_t)n;
    g_state.pending_generation++;
    set_last_event_locked("set_source", "stored pending source");
    pthread_mutex_unlock(&g_state.lock);
    snprintf(response, cap,
             "{\"ok\":true,\"pending_source_length\":%zu,"
             "\"pending_generation\":%llu}",
             (size_t)n, (unsigned long long)g_state.pending_generation);
    return;
  }

  uint64_t flags = 0;
  const char *pipeline_compile_prefix =
      "pipeline-python-to-bplist-b64-flags ";
  if (strncmp(cmd, pipeline_compile_prefix,
              strlen(pipeline_compile_prefix)) == 0) {
    const char *cursor = cmd + strlen(pipeline_compile_prefix);
    char *pipeline_end = NULL;
    uint64_t pipeline = strtoull(cursor, &pipeline_end, 10);
    if (pipeline_end == cursor || *pipeline_end != ' ') {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid runtime pipeline syntax\"}");
      return;
    }
    cursor = pipeline_end + 1;
    char *flags_end = NULL;
    flags = strtoull(cursor, &flags_end, 10);
    if (flags_end == cursor || *flags_end != ' ') {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid pipeline compile flags syntax\"}");
      return;
    }
    handle_pipeline_source_command(
        "pipeline_python_to_bplist", flags_end + 1, flags, pipeline, response,
        cap, bridge_swift_pipeline_python_to_bplist);
    return;
  }
  const char *pipeline_catalog_compile_prefix =
      "pipeline-python-to-bplist-catalog-b64-flags ";
  if (strncmp(cmd, pipeline_catalog_compile_prefix,
              strlen(pipeline_catalog_compile_prefix)) == 0) {
    char *cursor = (char *)cmd + strlen(pipeline_catalog_compile_prefix);
    char *pipelineEnd = NULL;
    uint64_t pipeline = strtoull(cursor, &pipelineEnd, 10);
    if (pipelineEnd == cursor || *pipelineEnd != ' ') {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid catalog runtime pipeline syntax\"}");
      return;
    }
    cursor = pipelineEnd + 1;
    char *flagsEnd = NULL;
    flags = strtoull(cursor, &flagsEnd, 10);
    if (flagsEnd == cursor || *flagsEnd != ' ') {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid pipeline catalog flags syntax\"}");
      return;
    }
    char *sourcePayload = flagsEnd + 1;
    char *catalogPayload = strchr(sourcePayload, ' ');
    if (!catalogPayload) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"missing pipeline catalog payload\"}");
      return;
    }
    *catalogPayload++ = 0;
    handle_pipeline_catalog_command(sourcePayload, catalogPayload, flags,
                                    pipeline, response, cap);
    return;
  }
  if (strncmp(cmd, "toolrenderer-python-interface", 29) == 0) {
    char *result = bridge_swift_toolrenderer_python_interface();
    if (!result) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"toolrenderer runner returned null\"}");
      return;
    }
    remember_result("toolrenderer_python_interface",
                    "toolrenderer_python_interface", "", 0, result);
    append_log("toolrenderer_python_interface");
    strlcpy(response, result, cap);
    free(result);
    return;
  }
  if (strncmp(cmd, "toolrenderer-structured-metadata", 32) == 0) {
    char *result = bridge_swift_toolrenderer_structured_metadata();
    if (!result) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"toolrenderer structured metadata runner returned null\"}");
      return;
    }
    remember_result("toolrenderer_structured_metadata",
                    "toolrenderer_structured_metadata", "", 0, result);
    append_log("toolrenderer_structured_metadata");
    strlcpy(response, result, cap);
    free(result);
    return;
  }
  if (strncmp(cmd, "catalog-dump-latest", 19) == 0) {
    char *result = bridge_swift_catalog_dump_latest();
    if (!result) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"catalog dump runner returned null\"}");
      return;
    }
    remember_result("catalog_dump_latest", "catalog_dump_latest", "", 0, result);
    append_log("catalog_dump_latest");
    strlcpy(response, result, cap);
    free(result);
    return;
  }
  if (strncmp(cmd, "catalog-encode-latest-debug", 27) == 0) {
    char *result = bridge_swift_catalog_encode_latest_debug();
    if (!result) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"catalog encode debug runner returned null\"}");
      return;
    }
    remember_result("catalog_encode_latest_debug", "catalog_encode_latest_debug",
                    "", 0, result);
    append_log("catalog_encode_latest_debug");
    strlcpy(response, result, cap);
    free(result);
    return;
  }
  if (strncmp(cmd, "expand-inline-catalog-b64 ", 26) == 0) {
    const char *request_payload = cmd + 26;
    uint8_t *decoded = calloc(1, MAX_PLIST_BYTES + 1);
    if (!decoded) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"failed to allocate inline catalog buffer\"}");
      return;
    }
    ssize_t n = decode_base64(request_payload, decoded, MAX_PLIST_BYTES);
    if (n < 0) {
      free(decoded);
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid base64 or inline catalog JSON too large\"}");
      return;
    }
    decoded[n] = 0;
    char *result = bridge_swift_expand_inline_catalog_metadata((const char *)decoded);
    if (!result) {
      free(decoded);
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"inline catalog expansion runner returned null\"}");
      return;
    }
    remember_result("expand_inline_catalog", "expand_inline_catalog",
                    (const char *)decoded, (size_t)n, result);
    append_log("expand_inline_catalog length=%zd", n);
    strlcpy(response, result, cap);
    free(result);
    free(decoded);
    return;
  }
  const char *pipeline_plist_prefix = "pipeline-plist-to-python-b64 ";
  if (strncmp(cmd, pipeline_plist_prefix, strlen(pipeline_plist_prefix)) == 0) {
    const char *cursor = cmd + strlen(pipeline_plist_prefix);
    char *pipeline_end = NULL;
    uint64_t pipeline = strtoull(cursor, &pipeline_end, 10);
    if (pipeline_end == cursor || *pipeline_end != ' ') {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid plist runtime pipeline syntax\"}");
      return;
    }
    uint8_t *decoded = calloc(1, MAX_SOURCE + 1);
    if (!decoded) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"failed to allocate plist JSON buffer\"}");
      return;
    }
    ssize_t n = decode_base64(pipeline_end + 1, decoded, MAX_SOURCE);
    if (n < 0) {
      free(decoded);
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid base64 or plist JSON too large\"}");
      return;
    }
    decoded[n] = 0;
    char *result = bridge_swift_pipeline_plist_to_python(
        (const char *)decoded, pipeline);
    if (!result) {
      free(decoded);
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"pipeline plist-to-python runner returned null\"}");
      return;
    }
    remember_result("pipeline_plist_to_python", "pipeline_plist_to_python",
                    (const char *)decoded, (size_t)n, result);
    strlcpy(response, result, cap);
    free(result);
    free(decoded);
    return;
  }
  const char *pipeline_plist_data_prefix =
      "pipeline-plist-data-to-python-b64 ";
  if (strncmp(cmd, pipeline_plist_data_prefix,
              strlen(pipeline_plist_data_prefix)) == 0) {
    const char *cursor = cmd + strlen(pipeline_plist_data_prefix);
    char *pipeline_end = NULL;
    uint64_t pipeline = strtoull(cursor, &pipeline_end, 10);
    if (pipeline_end == cursor || *pipeline_end != ' ') {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid plist-data runtime pipeline syntax\"}");
      return;
    }
    const char *plist_payload = pipeline_end + 1;
    size_t payload_len = strlen(plist_payload);
    size_t decoded_cap = (payload_len * 3) / 4 + 4;
    if (decoded_cap > MAX_PLIST_BYTES) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"plist data too large\"}");
      return;
    }
    uint8_t *decoded = calloc(1, decoded_cap + 1);
    if (!decoded) {
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"failed to allocate plist buffer\"}");
      return;
    }
    ssize_t n = decode_base64(plist_payload, decoded, decoded_cap);
    if (n < 0) {
      free(decoded);
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"invalid base64 or plist data too large\"}");
      return;
    }
    char *result = bridge_swift_pipeline_bplist_to_python(
        decoded, (size_t)n, pipeline);
    if (!result) {
      free(decoded);
      snprintf(response, cap,
               "{\"ok\":false,\"error\":\"pipeline plist-data-to-python runner returned null\"}");
      return;
    }
    remember_result("pipeline_bplist_to_python",
                    "pipeline_plist_data_to_python", "", (size_t)n, result);
    strlcpy(response, result, cap);
    free(result);
    free(decoded);
    return;
  }
  snprintf(response, cap,
           "{\"ok\":false,\"error\":\"unknown command\","
           "\"commands\":[\"status\",\"last\",\"clear\",\"set-source-b64\","
           "\"pipeline-python-to-bplist-b64-flags\","
           "\"pipeline-python-to-bplist-catalog-b64-flags\","
           "\"pipeline-plist-to-python-b64\","
           "\"pipeline-plist-data-to-python-b64\","
           "\"catalog-dump-latest\","
           "\"catalog-encode-latest-debug\","
           "\"expand-inline-catalog-b64\","
           "\"toolrenderer-python-interface\","
           "\"toolrenderer-structured-metadata\"]}");
}

static void serve_client(int fd) {
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags >= 0) {
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);
  }
  char *buf = calloc(1, MAX_COMMAND + 1);
  char *response = calloc(1, MAX_RESPONSE);
  if (!buf || !response) {
    free(buf);
    free(response);
    close(fd);
    return;
  }

  size_t total = 0;
  while (total < MAX_COMMAND) {
    ssize_t n = read(fd, buf + total, MAX_COMMAND - total);
    if (n <= 0) {
      break;
    }
    total += (size_t)n;
    if (memchr(buf, '\n', total)) {
      break;
    }
  }
  buf[total] = 0;
  char *newline = strchr(buf, '\n');
  append_log("client command bytes=%zu newline_offset=%zd max_command=%d", total,
             newline ? (ssize_t)(newline - buf) : (ssize_t)-1,
             MAX_COMMAND);
  if (newline) {
    *newline = 0;
  }

  handle_command(buf, response, MAX_RESPONSE);
  size_t len = strlen(response);
  size_t off = 0;
  while (off < len) {
    ssize_t wrote = write(fd, response + off, len - off);
    if (wrote <= 0) {
      break;
    }
    off += (size_t)wrote;
  }
  (void)write(fd, "\n", 1);
  free(buf);
  free(response);
  close(fd);
}

static int bind_socket_at(const char *path) {
  if (!path || !path[0] || strlen(path) >= sizeof(((struct sockaddr_un *)0)->sun_path)) {
    return -1;
  }
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    append_log("socket failed: %s", strerror(errno));
    return -1;
  }
  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  strlcpy(addr.sun_path, path, sizeof(addr.sun_path));
  unlink(path);
  if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    append_log("bind %s failed: %s", path, strerror(errno));
    close(fd);
    return -1;
  }
  chmod(path, 0600);
  if (listen(fd, 8) != 0) {
    append_log("listen %s failed: %s", path, strerror(errno));
    close(fd);
    return -1;
  }
  int flags = fcntl(fd, F_GETFL, 0);
  if (flags >= 0) {
    fcntl(fd, F_SETFL, flags | O_NONBLOCK);
  }
  pthread_mutex_lock(&g_state.lock);
  g_state.socket_ready = true;
  strlcpy(g_state.socket_path, path, sizeof(g_state.socket_path));
  set_last_event_locked("socket_ready", path);
  pthread_mutex_unlock(&g_state.lock);
  append_log("socket listening at %s", path);
  return fd;
}

static int make_socket(void) {
  char tmp_candidate[PATH_MAX];
  tmp_candidate[0] = 0;
  const char *tmp = getenv("TMPDIR");
  if (tmp && tmp[0]) {
    snprintf(tmp_candidate, sizeof(tmp_candidate), "%s/%s", tmp, SOCKET_NAME);
  }
  const char *candidates[] = {
      DEFAULT_SOCKET_PATH,
      tmp_candidate,
  };
  for (size_t i = 0; i < sizeof(candidates) / sizeof(candidates[0]); i++) {
    int fd = bind_socket_at(candidates[i]);
    if (fd >= 0) {
      return fd;
    }
  }
  return -1;
}

static void choose_log_path(void) {
  FILE *f = fopen(DEFAULT_LOG_PATH, "a");
  if (f) {
    fclose(f);
    return;
  }
  const char *tmp = getenv("TMPDIR");
  if (!tmp || !tmp[0]) {
    return;
  }
  char candidate[PATH_MAX];
  snprintf(candidate, sizeof(candidate), "%s/shortcuts-ide-bridge-sim.log", tmp);
  pthread_mutex_lock(&g_state.lock);
  strlcpy(g_state.log_path, candidate, sizeof(g_state.log_path));
  pthread_mutex_unlock(&g_state.lock);
}

static void *bridge_thread_main(void *arg) {
  (void)arg;
  choose_log_path();
  append_log("ShortcutsIDESimBridge %s loaded in pid %d", BRIDGE_VERSION,
             getpid());
  int listen_fd = make_socket();
  while (1) {
    if (listen_fd < 0) {
      sleep(1);
      listen_fd = make_socket();
      continue;
    }
    fd_set rfds;
    FD_ZERO(&rfds);
    FD_SET(listen_fd, &rfds);
    struct timeval tv = {.tv_sec = 1, .tv_usec = 0};
    int rc = select(listen_fd + 1, &rfds, NULL, NULL, &tv);
    if (rc <= 0) {
      continue;
    }
    int client = accept(listen_fd, NULL, NULL);
    if (client >= 0) {
      serve_client(client);
    }
  }
  return NULL;
}

__attribute__((constructor)) static void bridge_init(void) {
  pthread_t thread;
  if (pthread_create(&thread, NULL, bridge_thread_main, NULL) == 0) {
    pthread_detach(thread);
  }
}
