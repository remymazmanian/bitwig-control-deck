#include <CoreFoundation/CoreFoundation.h>
#include <CoreMIDI/CoreMIDI.h>
#include <signal.h>
#include <stdio.h>

static void midi_notification(const MIDINotification *message, void *context) {
    (void)message;
    (void)context;
}

static void midi_read(const MIDIPacketList *packets, void *context, void *connection) {
    (void)packets;
    (void)context;
    (void)connection;
}

int main(void) {
    MIDIClientRef client = 0;
    MIDIEndpointRef virtual_input = 0;
    MIDIEndpointRef virtual_output = 0;

    if (MIDIClientCreate(CFSTR("Control Deck Bridge"), midi_notification, NULL, &client) != noErr) {
        fputs("Control Deck could not create its CoreMIDI client.\n", stderr);
        return 1;
    }
    if (MIDISourceCreate(client, CFSTR("Control Deck Bridge In"), &virtual_input) != noErr) {
        fputs("Control Deck could not create its virtual MIDI input.\n", stderr);
        return 2;
    }
    if (MIDIDestinationCreate(client, CFSTR("Control Deck Bridge Out"), midi_read, NULL, &virtual_output) != noErr) {
        fputs("Control Deck could not create its virtual MIDI output.\n", stderr);
        return 3;
    }

    MIDIObjectSetStringProperty(virtual_input, kMIDIPropertyManufacturer, CFSTR("Control Deck"));
    MIDIObjectSetStringProperty(virtual_input, kMIDIPropertyModel, CFSTR("Control Deck Bridge"));
    MIDIObjectSetStringProperty(virtual_output, kMIDIPropertyManufacturer, CFSTR("Control Deck"));
    MIDIObjectSetStringProperty(virtual_output, kMIDIPropertyModel, CFSTR("Control Deck Bridge"));

    signal(SIGTERM, SIG_DFL);
    signal(SIGINT, SIG_DFL);
    CFRunLoopRun();
    return 0;
}
