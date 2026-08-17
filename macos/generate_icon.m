#import <Cocoa/Cocoa.h>

static NSColor *Color(CGFloat red, CGFloat green, CGFloat blue) {
    return [NSColor colorWithRed:red / 255.0 green:green / 255.0 blue:blue / 255.0 alpha:1.0];
}

static void drawIcon(NSUInteger pixels, NSString *destination) {
    NSImage *image = [[NSImage alloc] initWithSize:NSMakeSize(pixels, pixels)];
    [image lockFocus];
    [[NSGraphicsContext currentContext] setImageInterpolation:NSImageInterpolationHigh];

    NSRect canvas = NSMakeRect(0, 0, pixels, pixels);
    CGFloat radius = pixels * 0.22;
    NSBezierPath *background = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(canvas, pixels * 0.025, pixels * 0.025)
                                                               xRadius:radius
                                                               yRadius:radius];
    NSGradient *gradient = [[NSGradient alloc] initWithStartingColor:Color(8, 13, 14) endingColor:Color(27, 37, 39)];
    [gradient drawInBezierPath:background angle:-52.0];

    [NSGraphicsContext saveGraphicsState];
    [background addClip];
    [[Color(86, 213, 226) colorWithAlphaComponent:0.11] setStroke];
    CGFloat step = MAX(4.0, pixels / 9.0);
    for (CGFloat line = -pixels; line < pixels * 2; line += step) {
        NSBezierPath *gridLine = [NSBezierPath bezierPath];
        gridLine.lineWidth = MAX(0.5, pixels / 420.0);
        [gridLine moveToPoint:NSMakePoint(line, 0)];
        [gridLine lineToPoint:NSMakePoint(line + pixels, pixels)];
        [gridLine stroke];
    }
    [NSGraphicsContext restoreGraphicsState];

    CGFloat inset = pixels * 0.145;
    NSBezierPath *frame = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(canvas, inset, inset)
                                                          xRadius:pixels * 0.12
                                                          yRadius:pixels * 0.12];
    frame.lineWidth = MAX(1.0, pixels * 0.018);
    [[Color(199, 250, 69) colorWithAlphaComponent:0.94] setStroke];
    [frame stroke];

    NSFont *font = [NSFont systemFontOfSize:pixels * 0.49 weight:NSFontWeightBlack];
    NSDictionary *attributes = @{
        NSFontAttributeName: font,
        NSForegroundColorAttributeName: Color(232, 237, 240),
        NSKernAttributeName: @(pixels * -0.025)
    };
    NSString *monogram = @"C";
    NSSize monogramSize = [monogram sizeWithAttributes:attributes];
    NSPoint monogramOrigin = NSMakePoint((pixels - monogramSize.width) / 2.0 - pixels * 0.01,
                                        (pixels - monogramSize.height) / 2.0 + pixels * 0.018);
    [monogram drawAtPoint:monogramOrigin withAttributes:attributes];

    NSBezierPath *meterOne = [NSBezierPath bezierPathWithRoundedRect:NSMakeRect(pixels * 0.27, pixels * 0.205, pixels * 0.075, pixels * 0.018)
                                                             xRadius:pixels * 0.009
                                                             yRadius:pixels * 0.009];
    NSBezierPath *meterTwo = [NSBezierPath bezierPathWithRoundedRect:NSMakeRect(pixels * 0.365, pixels * 0.205, pixels * 0.14, pixels * 0.018)
                                                             xRadius:pixels * 0.009
                                                             yRadius:pixels * 0.009];
    [Color(199, 250, 69) setFill];
    [meterOne fill];
    [meterTwo fill];

    NSBezierPath *status = [NSBezierPath bezierPathWithOvalInRect:NSMakeRect(pixels * 0.75, pixels * 0.18, pixels * 0.075, pixels * 0.075)];
    [Color(86, 213, 226) setFill];
    [status fill];

    [image unlockFocus];
    NSBitmapImageRep *representation = [[NSBitmapImageRep alloc] initWithData:image.TIFFRepresentation];
    NSData *png = [representation representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    [png writeToFile:destination atomically:YES];
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 2) return 2;
        NSString *directory = [NSString stringWithUTF8String:argv[1]];
        NSArray<NSDictionary *> *icons = @[
            @{@"name": @"icon_16x16.png", @"size": @16},
            @{@"name": @"icon_16x16@2x.png", @"size": @32},
            @{@"name": @"icon_32x32.png", @"size": @32},
            @{@"name": @"icon_32x32@2x.png", @"size": @64},
            @{@"name": @"icon_128x128.png", @"size": @128},
            @{@"name": @"icon_128x128@2x.png", @"size": @256},
            @{@"name": @"icon_256x256.png", @"size": @256},
            @{@"name": @"icon_256x256@2x.png", @"size": @512},
            @{@"name": @"icon_512x512.png", @"size": @512},
            @{@"name": @"icon_512x512@2x.png", @"size": @1024}
        ];
        for (NSDictionary *icon in icons) {
            drawIcon([icon[@"size"] unsignedIntegerValue], [directory stringByAppendingPathComponent:icon[@"name"]]);
        }
    }
    return 0;
}
