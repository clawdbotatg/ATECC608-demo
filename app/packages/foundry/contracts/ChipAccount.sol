// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { P256 } from "@openzeppelin/contracts/utils/cryptography/P256.sol";

/**
 * @title ChipAccount
 * @notice A token vault owned by a NIST P-256 public key that lives inside an ATECC608 secure element.
 *
 *  The chip never touches the chain. It signs a 32-byte EIP-712 digest describing a token transfer
 *  (a meta-transaction). Anyone — in the demo, a relay that pays gas — submits the signature to
 *  `executeTransfer`, the contract verifies it against the chip's public key, and moves the tokens.
 *
 *  Why P-256 and not ecrecover: the ATECC608 only speaks secp256r1. Verification uses OpenZeppelin's
 *  P256 library, which calls the RIP-7212 / EIP-7951 precompile when the chain has it and falls back to a
 *  pure-Solidity verifier otherwise (local anvil works either way).
 */
contract ChipAccount is EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant TRANSFER_TYPEHASH =
        keccak256("Transfer(address token,address to,uint256 amount,uint256 nonce,uint256 deadline)");

    /// @notice Public key of the signing chip (P-256 affine coordinates).
    bytes32 public signerX;
    bytes32 public signerY;

    /// @notice Can (re)pair the chip key. On localhost this is the relay, so pairing is automatic.
    address public admin;

    /// @notice Replay protection. Each signed transfer must carry the current nonce.
    uint256 public nonce;

    event SignerSet(bytes32 indexed qx, bytes32 indexed qy, address by);
    event AdminChanged(address indexed previous, address indexed current);
    event TransferExecuted(
        address indexed token, address indexed to, uint256 amount, uint256 indexed nonce, address relayer
    );

    error NotAdmin();
    error SignerNotSet();
    error Expired(uint256 deadline, uint256 nowTs);
    error BadSignature();
    error ZeroAddress();

    constructor(address _admin, bytes32 _qx, bytes32 _qy) EIP712("ChipAccount", "1") {
        if (_admin == address(0)) revert ZeroAddress();
        admin = _admin;
        if (_qx != 0 || _qy != 0) {
            signerX = _qx;
            signerY = _qy;
            emit SignerSet(_qx, _qy, msg.sender);
        }
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    // ---------------------------------------------------------------- admin

    /// @notice Pair (or re-pair) the chip. Called once the Pi announces its public key.
    function setSigner(bytes32 _qx, bytes32 _qy) external onlyAdmin {
        signerX = _qx;
        signerY = _qy;
        emit SignerSet(_qx, _qy, msg.sender);
    }

    function setAdmin(address _admin) external onlyAdmin {
        if (_admin == address(0)) revert ZeroAddress();
        emit AdminChanged(admin, _admin);
        admin = _admin;
    }

    // ---------------------------------------------------------------- views

    function signer() external view returns (bytes32 qx, bytes32 qy) {
        return (signerX, signerY);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice The exact 32 bytes the chip signs for a given transfer.
    function hashTransfer(address token, address to, uint256 amount, uint256 _nonce, uint256 deadline)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(TRANSFER_TYPEHASH, token, to, amount, _nonce, deadline)));
    }

    /// @notice Convenience: the digest for the *next* transfer (uses the current nonce).
    function nextTransferDigest(address token, address to, uint256 amount, uint256 deadline)
        external
        view
        returns (bytes32 digest, uint256 currentNonce)
    {
        return (hashTransfer(token, to, amount, nonce, deadline), nonce);
    }

    /// @notice Check a chip signature without spending gas on a transaction.
    function isValidTransfer(address token, address to, uint256 amount, uint256 deadline, bytes32 r, bytes32 s)
        external
        view
        returns (bool)
    {
        if (signerX == 0 && signerY == 0) return false;
        return P256.verify(hashTransfer(token, to, amount, nonce, deadline), r, s, signerX, signerY);
    }

    // ---------------------------------------------------------------- execute

    /**
     * @notice Settle a chip-signed transfer. Anyone may call; the caller pays gas.
     * @dev The signature must be over `hashTransfer(token, to, amount, nonce, deadline)` with the current
     *      nonce, and `s` must be in the lower half of the curve order (OpenZeppelin rejects high-s).
     */
    function executeTransfer(address token, address to, uint256 amount, uint256 deadline, bytes32 r, bytes32 s)
        external
    {
        if (signerX == 0 && signerY == 0) revert SignerNotSet();
        if (block.timestamp > deadline) revert Expired(deadline, block.timestamp);
        if (to == address(0)) revert ZeroAddress();

        uint256 usedNonce = nonce;
        bytes32 digest = hashTransfer(token, to, amount, usedNonce, deadline);
        if (!P256.verify(digest, r, s, signerX, signerY)) revert BadSignature();

        nonce = usedNonce + 1;
        IERC20(token).safeTransfer(to, amount);
        emit TransferExecuted(token, to, amount, usedNonce, msg.sender);
    }

    /// @notice Accept ETH too, so the account can hold gas money if you ever want it to.
    receive() external payable { }
}
