use super::PROTOCOL_VERSION;
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Key, Nonce,
};
use rand::RngCore;
use serde::{de::DeserializeOwned, Serialize};
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

pub(super) const MEMBERSHIP: u8 = 1;
pub(super) const MESSAGE: u8 = 2;
pub(super) const SYNC_DATA: u8 = 3;
const HEADER_SIZE: usize = 8;
const MAX_BODY: usize = 2 * 1024 * 1024 - HEADER_SIZE;
const TIMEOUT: Duration = Duration::from_secs(10);

fn prefix(kind: u8) -> [u8; 4] {
    [b'L', b'M', PROTOCOL_VERSION, kind]
}

fn write_frame(writer: &mut impl Write, kind: u8, body: &[u8]) -> io::Result<()> {
    if body.is_empty() || body.len() > MAX_BODY {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid LAN frame size",
        ));
    }
    writer.write_all(&prefix(kind))?;
    writer.write_all(&(body.len() as u32).to_be_bytes())?;
    writer.write_all(body)
}

fn read_frame(reader: &mut impl Read) -> io::Result<(u8, Vec<u8>)> {
    let mut header = [0; HEADER_SIZE];
    reader.read_exact(&mut header)?;
    let kind = header[3];
    if header[..4] != prefix(kind) || !matches!(kind, MEMBERSHIP | MESSAGE | SYNC_DATA) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid LAN frame header",
        ));
    }
    let length = u32::from_be_bytes(header[4..].try_into().unwrap()) as usize;
    if !(1..=MAX_BODY).contains(&length) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid LAN frame size",
        ));
    }
    let mut body = vec![0; length];
    reader.read_exact(&mut body)?;
    Ok((kind, body))
}

struct DeadlineIo<'a> {
    stream: &'a mut TcpStream,
    deadline: Instant,
}

impl DeadlineIo<'_> {
    fn remaining(&self) -> io::Result<Duration> {
        self.deadline
            .checked_duration_since(Instant::now())
            .filter(|time| !time.is_zero())
            .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "LAN frame deadline exceeded"))
    }
}

impl Read for DeadlineIo<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.stream.set_read_timeout(Some(self.remaining()?))?;
        self.stream.read(buffer)
    }
}

impl Write for DeadlineIo<'_> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.stream.set_write_timeout(Some(self.remaining()?))?;
        self.stream.write(buffer)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.stream.flush()
    }
}

pub(super) fn read(stream: &mut TcpStream) -> Result<(u8, Vec<u8>), String> {
    read_with_timeout(stream, TIMEOUT)
}

fn read_with_timeout(stream: &mut TcpStream, timeout: Duration) -> Result<(u8, Vec<u8>), String> {
    read_frame(&mut DeadlineIo {
        stream,
        deadline: Instant::now() + timeout,
    })
    .map_err(|error| error.to_string())
}

pub(super) fn write(stream: &mut TcpStream, kind: u8, body: &[u8]) -> Result<(), String> {
    write_frame(
        &mut DeadlineIo {
            stream,
            deadline: Instant::now() + TIMEOUT,
        },
        kind,
        body,
    )
    .map_err(|error| error.to_string())
}

pub(super) fn send_bytes(
    stream: &mut TcpStream,
    kind: u8,
    body: &[u8],
    key: &[u8; 32],
) -> Result<(), String> {
    if body.len() > MAX_BODY - 28 {
        return Err("invalid LAN frame size".into());
    }
    let mut nonce = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce);
    let encrypted = ChaCha20Poly1305::new(Key::from_slice(key))
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: body,
                aad: &prefix(kind),
            },
        )
        .map_err(|_| "LAN frame encryption failed")?;
    let mut sealed = Vec::with_capacity(nonce.len() + encrypted.len());
    sealed.extend_from_slice(&nonce);
    sealed.extend_from_slice(&encrypted);
    write(stream, kind, &sealed)
}

pub(super) fn decrypt(kind: u8, sealed: &[u8], key: &[u8; 32]) -> Result<Vec<u8>, String> {
    if sealed.len() < 28 {
        return Err("truncated LAN frame".into());
    }
    let (nonce, encrypted) = sealed.split_at(12);
    ChaCha20Poly1305::new(Key::from_slice(key))
        .decrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: encrypted,
                aad: &prefix(kind),
            },
        )
        .map_err(|_| "LAN frame authentication failed".into())
}

pub(super) fn receive_bytes(
    stream: &mut TcpStream,
    expected: u8,
    key: &[u8; 32],
) -> Result<Vec<u8>, String> {
    let (kind, sealed) = read(stream)?;
    if kind != expected {
        return Err("unexpected LAN frame type".into());
    }
    decrypt(kind, &sealed, key)
}

pub(super) fn send<T: Serialize>(
    stream: &mut TcpStream,
    message: &T,
    key: &[u8; 32],
) -> Result<(), String> {
    let body = serde_json::to_vec(message).map_err(|error| error.to_string())?;
    send_bytes(stream, MESSAGE, &body, key)
}

pub(super) fn receive<T: DeserializeOwned>(
    stream: &mut TcpStream,
    key: &[u8; 32],
) -> Result<T, String> {
    receive_with_timeout(stream, key, TIMEOUT)
}

pub(super) fn receive_with_timeout<T: DeserializeOwned>(
    stream: &mut TcpStream,
    key: &[u8; 32],
    timeout: Duration,
) -> Result<T, String> {
    let (kind, sealed) = read_with_timeout(stream, timeout)?;
    if kind != MESSAGE {
        return Err("unexpected LAN message type".into());
    }
    let body = decrypt(kind, &sealed, key)?;
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_frames_reject_truncated_and_invalid_headers() {
        let mut valid = Vec::new();
        write_frame(&mut valid, MESSAGE, b"data").unwrap();
        assert_eq!(
            read_frame(&mut valid.as_slice()).unwrap(),
            (MESSAGE, b"data".to_vec())
        );
        assert!(read_frame(&mut &valid[..valid.len() - 1]).is_err());
        let mut unknown_version = valid.clone();
        unknown_version[2] -= 1;
        assert!(read_frame(&mut unknown_version.as_slice()).is_err());
        valid[4..8].copy_from_slice(&((MAX_BODY + 1) as u32).to_be_bytes());
        assert_eq!(
            read_frame(&mut valid.as_slice()).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
    }
}
