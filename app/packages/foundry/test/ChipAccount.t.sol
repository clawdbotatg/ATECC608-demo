// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import { P256 } from "@openzeppelin/contracts/utils/cryptography/P256.sol";
import { ChipAccount } from "../contracts/ChipAccount.sol";
import { MockUSDS } from "../contracts/MockUSDS.sol";

/// @dev Signatures come from pi/signer.py in --mock mode (ffi). Same code path the Pi runs, minus the chip.
contract ChipAccountTest is Test {
    string constant SIGNER = "../../../pi/signer.py";
    string constant KEY = "1111111111111111111111111111111111111111111111111111111111111111";
    string constant OTHER_KEY = "2222222222222222222222222222222222222222222222222222222222222222";

    ChipAccount account;
    MockUSDS usds;
    address admin = makeAddr("admin");
    address relayer = makeAddr("relayer");
    address alice = makeAddr("alice");
    bytes32 qx;
    bytes32 qy;

    event TransferExecuted(
        address indexed token, address indexed to, uint256 amount, uint256 indexed nonce, address relayer
    );

    function setUp() public {
        (qx, qy) = pubkey(KEY);
        usds = new MockUSDS();
        account = new ChipAccount(admin, qx, qy);
        usds.mint(address(account), 1_000 ether);
    }

    // ------------------------------------------------------------ helpers (ffi -> python)

    function pubkey(string memory key) internal returns (bytes32 x, bytes32 y) {
        string[] memory cmd = new string[](7);
        cmd[0] = "python3";
        cmd[1] = SIGNER;
        cmd[2] = "--mock";
        cmd[3] = "--mock-key";
        cmd[4] = key;
        cmd[5] = "--raw";
        cmd[6] = "pubkey";
        bytes memory out = vm.ffi(cmd);
        assertEq(out.length, 64, "pubkey ffi");
        (x, y) = abi.decode(out, (bytes32, bytes32));
    }

    function sign(string memory key, bytes32 digest) internal returns (bytes32 r, bytes32 s) {
        string[] memory cmd = new string[](9);
        cmd[0] = "python3";
        cmd[1] = SIGNER;
        cmd[2] = "--mock";
        cmd[3] = "--mock-key";
        cmd[4] = key;
        cmd[5] = "--raw";
        cmd[6] = "sign";
        cmd[7] = "--digest";
        cmd[8] = vm.toString(digest);
        bytes memory out = vm.ffi(cmd);
        assertEq(out.length, 64, "sign ffi");
        (r, s) = abi.decode(out, (bytes32, bytes32));
    }

    function signedTransfer(string memory key, address to, uint256 amount, uint256 deadline)
        internal
        returns (bytes32 r, bytes32 s)
    {
        bytes32 digest = account.hashTransfer(address(usds), to, amount, account.nonce(), deadline);
        return sign(key, digest);
    }

    // ------------------------------------------------------------ tests

    function test_executeTransfer_movesTokensAndBumpsNonce() public {
        uint256 deadline = block.timestamp + 10 minutes;
        (bytes32 r, bytes32 s) = signedTransfer(KEY, alice, 5 ether, deadline);

        assertTrue(account.isValidTransfer(address(usds), alice, 5 ether, deadline, r, s));

        vm.expectEmit(true, true, true, true);
        emit TransferExecuted(address(usds), alice, 5 ether, 0, relayer);
        vm.prank(relayer); // relay pays gas, holds no tokens, has no key
        account.executeTransfer(address(usds), alice, 5 ether, deadline, r, s);

        assertEq(usds.balanceOf(alice), 5 ether);
        assertEq(usds.balanceOf(address(account)), 995 ether);
        assertEq(account.nonce(), 1);
    }

    function test_replayIsRejected() public {
        uint256 deadline = block.timestamp + 10 minutes;
        (bytes32 r, bytes32 s) = signedTransfer(KEY, alice, 5 ether, deadline);
        account.executeTransfer(address(usds), alice, 5 ether, deadline, r, s);

        vm.expectRevert(ChipAccount.BadSignature.selector);
        account.executeTransfer(address(usds), alice, 5 ether, deadline, r, s);
        assertEq(usds.balanceOf(alice), 5 ether);
    }

    function test_tamperedAmountIsRejected() public {
        uint256 deadline = block.timestamp + 10 minutes;
        (bytes32 r, bytes32 s) = signedTransfer(KEY, alice, 5 ether, deadline);
        vm.expectRevert(ChipAccount.BadSignature.selector);
        account.executeTransfer(address(usds), alice, 6 ether, deadline, r, s);
    }

    function test_tamperedRecipientIsRejected() public {
        uint256 deadline = block.timestamp + 10 minutes;
        (bytes32 r, bytes32 s) = signedTransfer(KEY, alice, 5 ether, deadline);
        vm.expectRevert(ChipAccount.BadSignature.selector);
        account.executeTransfer(address(usds), relayer, 5 ether, deadline, r, s);
    }

    function test_wrongKeyIsRejected() public {
        uint256 deadline = block.timestamp + 10 minutes;
        (bytes32 r, bytes32 s) = signedTransfer(OTHER_KEY, alice, 5 ether, deadline);
        assertFalse(account.isValidTransfer(address(usds), alice, 5 ether, deadline, r, s));
        vm.expectRevert(ChipAccount.BadSignature.selector);
        account.executeTransfer(address(usds), alice, 5 ether, deadline, r, s);
    }

    function test_expiredIsRejected() public {
        uint256 deadline = block.timestamp + 1;
        (bytes32 r, bytes32 s) = signedTransfer(KEY, alice, 5 ether, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(ChipAccount.Expired.selector, deadline, deadline + 1));
        account.executeTransfer(address(usds), alice, 5 ether, deadline, r, s);
    }

    function test_insufficientBalanceReverts() public {
        uint256 deadline = block.timestamp + 10 minutes;
        (bytes32 r, bytes32 s) = signedTransfer(KEY, alice, 1_001 ether, deadline);
        vm.expectRevert();
        account.executeTransfer(address(usds), alice, 1_001 ether, deadline, r, s);
        assertEq(account.nonce(), 0, "nonce must not advance on a failed transfer");
    }

    function test_unpairedAccountRevertsUntilSignerSet() public {
        ChipAccount fresh = new ChipAccount(admin, 0, 0);
        usds.mint(address(fresh), 10 ether);
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 digest = fresh.hashTransfer(address(usds), alice, 1 ether, 0, deadline);
        (bytes32 r, bytes32 s) = sign(KEY, digest);

        assertFalse(fresh.isValidTransfer(address(usds), alice, 1 ether, deadline, r, s));
        vm.expectRevert(ChipAccount.SignerNotSet.selector);
        fresh.executeTransfer(address(usds), alice, 1 ether, deadline, r, s);

        // the Pi announces its key, the admin (relay on localhost) pairs it
        vm.prank(admin);
        fresh.setSigner(qx, qy);
        fresh.executeTransfer(address(usds), alice, 1 ether, deadline, r, s);
        assertEq(usds.balanceOf(alice), 1 ether);
    }

    function test_onlyAdminCanSetSigner() public {
        vm.prank(alice);
        vm.expectRevert(ChipAccount.NotAdmin.selector);
        account.setSigner(bytes32(uint256(1)), bytes32(uint256(2)));

        vm.prank(admin);
        account.setAdmin(alice);
        vm.prank(alice);
        account.setSigner(bytes32(uint256(1)), bytes32(uint256(2)));
        (bytes32 x, bytes32 y) = account.signer();
        assertEq(x, bytes32(uint256(1)));
        assertEq(y, bytes32(uint256(2)));
    }

    function test_digestMatchesEip712() public view {
        // Reproduce the digest the app computes offchain with viem's hashTypedData.
        uint256 deadline = 1_900_000_000;
        bytes32 structHash =
            keccak256(abi.encode(account.TRANSFER_TYPEHASH(), address(usds), alice, 5 ether, uint256(0), deadline));
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", account.domainSeparator(), structHash));
        assertEq(account.hashTransfer(address(usds), alice, 5 ether, 0, deadline), expected);
    }

    /// forge-config: default.fuzz.runs = 12
    function testFuzz_anyAmountUpToBalance(uint256 amount, address to) public {
        vm.assume(to != address(0) && to != address(account));
        amount = bound(amount, 0, 1_000 ether);
        uint256 deadline = block.timestamp + 10 minutes;
        uint256 before = usds.balanceOf(to);
        (bytes32 r, bytes32 s) = signedTransfer(KEY, to, amount, deadline);
        vm.prank(relayer);
        account.executeTransfer(address(usds), to, amount, deadline, r, s);
        assertEq(usds.balanceOf(to) - before, amount);
    }

    /// Known-answer vector (generated with python `cryptography`, low-s normalised) — exercises the
    /// OpenZeppelin verifier itself without ffi.
    function test_p256KnownAnswerVector() public view {
        bytes32 x = 0x0217e617f0b6443928278f96999e69a23a4f2c152bdf6d6cdf66e5b80282d4ed;
        bytes32 y = 0x194a7debcb97712d2dda3ca85aa8765a56f45fc758599652f2897c65306e5794;
        bytes32 h = 0x6d6f636b2d64696765737400000000000000000000000000000000000000abcd;
        bytes32 r = 0x4d80163031a75ade946ee6186599d84cfb057e7ad9bc84f2980768791f4ef508;
        bytes32 s = 0x3c5c7777a0c4df9ba7051f5534fca7dedb146e09e32987e3ba70db3dc096cf24;
        assertTrue(P256.verify(h, r, s, x, y));
        assertFalse(P256.verify(bytes32(uint256(h) ^ 1), r, s, x, y));
    }
}
