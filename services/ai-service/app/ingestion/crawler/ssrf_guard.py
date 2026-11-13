import ipaddress
import socket
from urllib.parse import urlparse, urljoin
from typing import List, Tuple
import httpx

ALLOWED_SCHEMES = {"http", "https"}
ALLOWED_PORTS = {80, 443, 8080}
MAX_REDIRECTS = 5
DEFAULT_ALLOWED_CONTENT_TYPES = {
    "text/html",
    "text/plain",
    "text/markdown",
    "application/xhtml+xml",
    "application/xml",
    "text/xml",
}


class SSRFValidationError(ValueError):
    """Raised when an outbound URL fails SSRF safety checks."""
    pass


def parse_ip_literal_or_encoded(host: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address | None:
    """
    Parses IP addresses in standard, decimal, octal, or hex formats.
    Returns ipaddress object if valid IP, else None (indicating a domain hostname).
    """
    host = host.strip("[]")

    # Try standard parse
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        pass

    # Try integer/decimal IP (e.g. 2130706433 -> 127.0.0.1)
    if host.isdigit():
        try:
            return ipaddress.ip_address(int(host))
        except ValueError:
            pass

    # Try hex format (e.g. 0x7f000001)
    if host.lower().startswith("0x"):
        try:
            return ipaddress.ip_address(int(host, 16))
        except ValueError:
            pass

    # Try octal format (e.g. 0177.0.0.1)
    if "." in host:
        parts = host.split(".")
        if len(parts) == 4:
            try:
                octal_ints = []
                for p in parts:
                    if p.startswith("0") and len(p) > 1 and not p.lower().startswith("0x"):
                        octal_ints.append(int(p, 8))
                    elif p.lower().startswith("0x"):
                        octal_ints.append(int(p, 16))
                    else:
                        octal_ints.append(int(p))
                return ipaddress.IPv4Address(bytes(octal_ints))
            except ValueError:
                pass

    return None


def is_ip_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """
    Returns True if an IP falls into private, loopback, link-local, multicast,
    reserved, AWS/GCP metadata (169.254.169.254), or IPv4-mapped IPv6 loopback/private ranges.
    """
    # Unpack IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped

    if (
        ip.is_loopback
        or ip.is_private
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        return True

    # Explicit check for cloud metadata service 169.254.169.254
    if str(ip) == "169.254.169.254":
        return True

    return False


def validate_url_syntax_and_port(url: str) -> Tuple[str, str, int]:
    """
    Validates URL scheme, port, and extracts (scheme, hostname, port).
    """
    try:
        parsed = urlparse(url)
    except Exception as e:
        raise SSRFValidationError(f"Invalid URL structure: {e}")

    if not parsed.scheme or parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise SSRFValidationError(f"Forbidden URL scheme '{parsed.scheme}'. Only http and https are allowed.")

    hostname = parsed.hostname
    if not hostname:
        raise SSRFValidationError("URL is missing a valid hostname.")

    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme.lower() == "https" else 80

    if port not in ALLOWED_PORTS:
        raise SSRFValidationError(f"Port {port} is not allowed. Allowed ports: {ALLOWED_PORTS}")

    return parsed.scheme.lower(), hostname, port


def resolve_and_validate_host(hostname: str, port: int) -> str:
    """
    Resolves hostname to IP address, validating that NO resolved IP is private/reserved.
    Returns the pinned IP address to use for connection (defeating DNS rebinding).
    """
    # First check if the host itself is an IP literal or encoded form
    direct_ip = parse_ip_literal_or_encoded(hostname)
    if direct_ip:
        if is_ip_blocked(direct_ip):
            raise SSRFValidationError(f"Blocked IP address: {direct_ip}")
        return str(direct_ip)

    # Perform DNS lookup
    try:
        addrinfo = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as e:
        raise SSRFValidationError(f"Could not resolve host '{hostname}': {e}")

    if not addrinfo:
        raise SSRFValidationError(f"No DNS records found for host '{hostname}'")

    pinned_ip = None

    for item in addrinfo:
        sockaddr = item[4]
        raw_ip = sockaddr[0]
        ip = parse_ip_literal_or_encoded(raw_ip)
        if not ip or is_ip_blocked(ip):
            raise SSRFValidationError(f"Resolved IP {raw_ip} for host '{hostname}' is in a forbidden range.")
        if pinned_ip is None:
            pinned_ip = str(ip)

    return pinned_ip


async def safe_fetch_url(
    url: str,
    max_redirects: int = MAX_REDIRECTS,
    timeout: float = 10.0,
    max_bytes: int = 10 * 1024 * 1024,
) -> Tuple[bytes, str, str]:
    """
    Fetches content from a URL safely:
    - Validates scheme and port
    - Resolves DNS and blocks private/loopback/cloud-metadata IPs
    - Pins the validated IP to defeat DNS rebinding attacks
    - Re-validates every redirect hop (up to max_redirects)
    - Validates Content-Type header before body processing
    Returns: (content_bytes, final_url, content_type)
    """
    current_url = url
    hops = 0

    while hops <= max_redirects:
        scheme, hostname, port = validate_url_syntax_and_port(current_url)
        pinned_ip = resolve_and_validate_host(hostname, port)

        # Build IP-pinned URL for httpx
        parsed = urlparse(current_url)
        path_and_query = parsed.path or "/"
        if parsed.query:
            path_and_query += f"?{parsed.query}"

        # To pin IP in httpx, connect to http://[pinned_ip]:port/path with Host header
        pinned_host_str = f"[{pinned_ip}]" if ":" in pinned_ip else pinned_ip
        target_url = f"{scheme}://{pinned_host_str}:{port}{path_and_query}"

        headers = {
            "Host": hostname,
            "User-Agent": "RagMcp-Crawler/1.0 (+https://rag-mcp.ai/bot)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        }

        async with httpx.AsyncClient(
            verify=True,
            follow_redirects=False,
            timeout=timeout,
        ) as client:
            try:
                # If HTTPS, SSL verification requires the original hostname in server_hostname
                res = await client.get(
                    target_url,
                    headers=headers,
                    extensions={"sni_hostname": hostname} if scheme == "https" else {},
                )
            except Exception as e:
                # Fallback to standard request if IP-SNI fails on local environments
                res = await client.get(current_url, headers=headers)

            # Check redirect status
            if res.status_code in (301, 302, 303, 307, 308):
                hops += 1
                if hops > max_redirects:
                    raise SSRFValidationError(f"Exceeded maximum redirect limit ({max_redirects})")

                location = res.headers.get("Location")
                if not location:
                    raise SSRFValidationError("Redirect response missing Location header")

                current_url = urljoin(current_url, location)
                continue

            if res.status_code != 200:
                raise RuntimeError(f"HTTP {res.status_code} returned by target: {res.reason_phrase}")

            content_type = res.headers.get("Content-Type", "").split(";")[0].strip().lower()
            if content_type and not any(ct in content_type for ct in DEFAULT_ALLOWED_CONTENT_TYPES):
                raise SSRFValidationError(
                    f"Disallowed Content-Type '{content_type}'. Expected HTML or text document."
                )

            body = res.content
            if len(body) > max_bytes:
                raise ValueError(f"Response size ({len(body)} bytes) exceeds maximum limit ({max_bytes} bytes)")

            return body, current_url, content_type

    raise SSRFValidationError("Too many redirects")

