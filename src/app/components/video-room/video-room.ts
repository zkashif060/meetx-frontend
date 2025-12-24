import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { io, Socket } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

interface Participant {
  id: string;
  stream: MediaStream;
  peerConnection: RTCPeerConnection;
  cameraOn: boolean;
  micOn: boolean;
}

@Component({
  selector: 'app-video-room',
  imports: [CommonModule, FormsModule],
  templateUrl: './video-room.html',
  styleUrls: ['./video-room.scss'],
  standalone: true
})
export class VideoRoom implements OnInit {
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  socket!: Socket;
  localStream!: MediaStream;
  participants: Map<string, Participant> = new Map();
  cameraOn = false;
  micOn = false;

  // For link-based rooms
  meetingLink: string | null = null;
  joinRoomId: string = '';
  roomId: string = '';

  ngOnInit() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      this.joinRoomId = room;
      this.joinMeeting();
    }
  }

  startMeeting() {
    this.roomId = uuidv4();
    this.meetingLink = `${window.location.origin}/?room=${this.roomId}`;
    this.joinRoom(this.roomId);
  }

  joinMeeting() {
    if (!this.joinRoomId) {
      alert('Enter a Room ID to join');
      return;
    }

    // Extract room ID if a full URL is pasted
    let roomIdToJoin = this.joinRoomId;
    try {
      const url = new URL(this.joinRoomId);
      const roomParam = url.searchParams.get('room');
      if (roomParam) {
        roomIdToJoin = roomParam;
      }
    } catch (e) {
      // Not a URL, use as is
    }

    this.roomId = roomIdToJoin;
    this.meetingLink = `${window.location.origin}/?room=${this.roomId}`;
    this.joinRoom(this.roomId);
  }

  joinRoom(roomId: string) {
    const backendUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? 'http://127.0.0.1:5000'
      : 'http://127.0.0.1:4040';

    this.socket = io(backendUrl, {
      transports: ['websocket'],
      forceNew: true
    });

    this.setupLocalMedia().then(() => {
      this.socket.emit('join-room', roomId);

      // Existing users when new user joins
      this.socket.on('existing-users', (users: string[]) => {
        users.forEach(userId => this.createPeerConnection(userId, true));
      });

      // New participant joined
      this.socket.on('user-joined', (userId: string) => {
        this.createPeerConnection(userId, false);
      });

      // Signaling messages
      this.socket.on('signal', (data: any) => this.handleSignal(data));

      // Participant left
      this.socket.on('user-left', (userId: string) => this.removeParticipant(userId));
    });
  }

  copyMeetingLink() {
    if (!this.meetingLink) return;
    navigator.clipboard.writeText(this.meetingLink)
      .then(() => console.log('Link copied'))
      .catch(err => console.error('Copy failed', err));
  }


  async setupLocalMedia() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasCamera = devices.some(d => d.kind === 'videoinput');
      const hasMic = devices.some(d => d.kind === 'audioinput');

      if (!hasCamera && !hasMic) {
        alert('No camera or microphone found.');
        this.localStream = new MediaStream();
        return;
      }

      this.localStream = await navigator.mediaDevices.getUserMedia({
        video: hasCamera,
        audio: hasMic
      });

      this.localVideo.nativeElement.srcObject = this.localStream;
      this.localVideo.nativeElement.muted = true;
      await this.localVideo.nativeElement.play();

      this.cameraOn = hasCamera;
      this.micOn = hasMic;
    } catch (err: any) {
      console.error('Camera/mic access denied', err);
      alert('Camera or microphone access denied!');
      this.localStream = new MediaStream();
    }
  }

  createPeerConnection(userId: string, isOfferer: boolean) {
    const pc = new RTCPeerConnection();
    this.localStream.getTracks().forEach(track => pc.addTrack(track, this.localStream));

    const participant: Participant = {
      id: userId,
      stream: new MediaStream(),
      peerConnection: pc,
      cameraOn: true,
      micOn: true
    };
    this.participants.set(userId, participant);

    pc.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => participant.stream.addTrack(track));
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', { to: userId, signal: { candidate: event.candidate } });
      }
    };

    if (isOfferer) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        this.socket.emit('signal', { to: userId, signal: { sdp: offer } });
      });
    }

    return participant;
  }

  async handleSignal(data: any) {
    const userId = data.from;
    let participant = this.participants.get(userId);
    if (!participant) participant = this.createPeerConnection(userId, false);

    const pc = participant.peerConnection;
    const signal = data.signal;

    if (signal.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      if (signal.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('signal', { to: userId, signal: { sdp: answer } });
      }
    } else if (signal.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
    }
  }

  removeParticipant(userId: string) {
    const participant = this.participants.get(userId);
    if (participant) {
      participant.stream.getTracks().forEach(track => track.stop());
      participant.peerConnection.close();
      this.participants.delete(userId);
    }
  }

  async toggleCamera() {
    if (!this.localStream) this.localStream = new MediaStream();
    const videoTrack = this.localStream.getVideoTracks()[0];

    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.cameraOn = videoTrack.enabled;
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        const track = stream.getVideoTracks()[0];
        this.localStream.addTrack(track);
        this.localVideo.nativeElement.srcObject = this.localStream;
        this.participants.forEach(p => {
          const sender = p.peerConnection.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(track);
        });
        this.cameraOn = true;
      } catch (err) {
        console.error('Camera access denied', err);
      }
    }
  }

  async toggleMic() {
    if (!this.localStream) this.localStream = new MediaStream();
    const audioTrack = this.localStream.getAudioTracks()[0];

    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.micOn = audioTrack.enabled;
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = stream.getAudioTracks()[0];
        this.localStream.addTrack(track);
        this.participants.forEach(p => {
          const sender = p.peerConnection.getSenders().find(s => s.track?.kind === 'audio');
          if (sender) sender.replaceTrack(track);
        });
        this.micOn = true;
      } catch (err) {
        console.error('Microphone access denied', err);
      }
    }
  }

  async shareScreen() {
    try {
      const screenStream = await (navigator.mediaDevices as any).getDisplayMedia({ video: true });
      const videoTrack = screenStream.getVideoTracks()[0];

      this.participants.forEach(p => {
        const sender = p.peerConnection.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(videoTrack);
      });

      this.localVideo.nativeElement.srcObject = screenStream;

      videoTrack.onended = () => {
        this.localVideo.nativeElement.srcObject = this.localStream;
        this.participants.forEach(p => {
          const sender = p.peerConnection.getSenders().find(s => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(this.localStream.getVideoTracks()[0]);
        });
      };
    } catch (err) {
      console.error('Screen sharing failed', err);
    }
  }
}
