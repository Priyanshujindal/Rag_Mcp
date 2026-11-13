import pytest
from app.ingestion.crawler.ssrf_guard import (
    SSRFValidationError,
    is_ip_blocked,
    parse_ip_literal_or_encoded,
    resolve_and_validate_host,
    validate_url_syntax_and_port,
)


def test_private_and_loopback_ips_blocked():
    """Verify loopback, private ranges, and cloud metadata are identified as blocked."""
    # Loopback
    assert is_ip_blocked(parse_ip_literal_or_encoded("127.0.0.1"))
    assert is_ip_blocked(parse_ip_literal_or_encoded("127.0.1.1"))

    # Private RFC 1918
    assert is_ip_blocked(parse_ip_literal_or_encoded("10.0.0.1"))
    assert is_ip_blocked(parse_ip_literal_or_encoded("192.168.1.100"))
    assert is_ip_blocked(parse_ip_literal_or_encoded("172.16.0.50"))

    # AWS/GCP Metadata service
    assert is_ip_blocked(parse_ip_literal_or_encoded("169.254.169.254"))

    # Public IP should NOT be blocked
    assert not is_ip_blocked(parse_ip_literal_or_encoded("8.8.8.8"))
    assert not is_ip_blocked(parse_ip_literal_or_encoded("93.184.216.34"))


def test_ipv6_and_mapped_ipv6_blocked():
    """Verify IPv6 loopback, link-local, and IPv4-mapped IPv6 are blocked."""
    # IPv6 Loopback ::1
    assert is_ip_blocked(parse_ip_literal_or_encoded("::1"))

    # IPv6 Link-local fe80::/10
    assert is_ip_blocked(parse_ip_literal_or_encoded("fe80::1"))

    # IPv4-mapped IPv6 (::ffff:127.0.0.1)
    assert is_ip_blocked(parse_ip_literal_or_encoded("::ffff:127.0.0.1"))
    assert is_ip_blocked(parse_ip_literal_or_encoded("::ffff:10.0.0.1"))


def test_encoded_ip_formats_blocked():
    """Verify decimal, hex, and octal integer formats are parsed and blocked."""
    # Decimal/Integer IP: 2130706433 = 127.0.0.1
    dec_ip = parse_ip_literal_or_encoded("2130706433")
    assert dec_ip is not None
    assert is_ip_blocked(dec_ip)

    # Hex IP: 0x7f000001 = 127.0.0.1
    hex_ip = parse_ip_literal_or_encoded("0x7f000001")
    assert hex_ip is not None
    assert is_ip_blocked(hex_ip)

    # Octal IP: 0177.0.0.1 = 127.0.0.1
    oct_ip = parse_ip_literal_or_encoded("0177.0.0.1")
    assert oct_ip is not None
    assert is_ip_blocked(oct_ip)


def test_forbidden_schemes_rejected():
    """Verify only http and https are allowed."""
    with pytest.raises(SSRFValidationError) as exc1:
        validate_url_syntax_and_port("file:///etc/passwd")
    assert "Forbidden URL scheme" in str(exc1.value)

    with pytest.raises(SSRFValidationError) as exc2:
        validate_url_syntax_and_port("gopher://127.0.0.1:70")
    assert "Forbidden URL scheme" in str(exc2.value)


def test_forbidden_ports_rejected():
    """Verify non-standard ports are blocked."""
    with pytest.raises(SSRFValidationError) as exc1:
        validate_url_syntax_and_port("http://example.com:22/")
    assert "Port 22 is not allowed" in str(exc1.value)

    with pytest.raises(SSRFValidationError) as exc2:
        validate_url_syntax_and_port("http://example.com:3306/")
    assert "Port 3306 is not allowed" in str(exc2.value)


def test_valid_urls_accepted():
    """Verify public URLs with standard ports pass validation."""
    scheme, host, port = validate_url_syntax_and_port("https://example.com/docs")
    assert scheme == "https"
    assert host == "example.com"
    assert port == 443

    scheme2, host2, port2 = validate_url_syntax_and_port("http://example.com:8080/api")
    assert scheme2 == "http"
    assert host2 == "example.com"
    assert port2 == 8080


def test_resolve_and_validate_host_blocks_direct_ip():
    """Verify host resolution immediately rejects private direct host strings."""
    with pytest.raises(SSRFValidationError) as exc:
        resolve_and_validate_host("169.254.169.254", 80)
    assert "Blocked IP address" in str(exc.value)

    with pytest.raises(SSRFValidationError) as exc2:
        resolve_and_validate_host("127.0.0.1", 80)
    assert "Blocked IP address" in str(exc2.value)

